/* Scrape NanoBanana Image To Image
* Base : https://imgeditor[dot]co
* Sumber : https://whatsapp.com/channel/0029VbAj9Sd47XeLArtDqO3X
* Note : Auto register akunlama, menggunakan @rynn-k/proxy-agent dan @sptzx/request - Auto Generate 2 Photo
*/

const fs = require('fs');
const path = require('path');
const crypto = require("crypto");
const cheerio = require("cheerio");
const ProxyAgent = require('@rynn-k/proxy-agent');

let request, CookieJar;

async function initLib() {
    if (!request) {
        const reqModule = await import('@sptzx/request');
        request = reqModule.default;
        CookieJar = reqModule.CookieJar;
    }
}

class EmailService {
    constructor(session) {
        this.session = session;
        this.baseUrl = "https://akunlama.com/api";
    }

    async generateEmail() {
        const name = crypto.randomBytes(4).toString('hex');
        return `${name}@akunlama.com`;
    }

    async waitForOTP(email, timeout = 120000) {
        const start = Date.now();
        console.log(`[Email] Menunggu OTP untuk: ${email}...`);

        while (Date.now() - start < timeout) {
            try {
                const res = await this.session.get(`${this.baseUrl}/list`, {
                    searchParams: { recipient: email }
                }).json();

                if (Array.isArray(res) && res.length > 0) {
                    const latest = res[0];
                    const htmlRes = await this.session.get(`${this.baseUrl}/getHtml`, {
                        searchParams: { region: latest.storage.region, key: latest.storage.key }
                    }).text();

                    const otpMatch = htmlRes.match(/font-size:\s*32px[^>]*>\s*(\d{6})\s*<\/span>/i) || htmlRes.match(/\b\d{6}\b/);
                    if (otpMatch) return otpMatch[1] || otpMatch[0];
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 5000));
        }
        throw new Error("OTP_TIMEOUT");
    }
}

class ImgEditorClient {
    constructor(session) {
        this.session = session;
        this.mail = new EmailService(this.session);
        this.baseUrl = "https://imgeditor.co";
    }

    async login() {
        await this.session.get(`${this.baseUrl}/auth/signin`);
        const email = await this.mail.generateEmail();
        console.log(`[Auth] Registrasi email: ${email}`);

        const { csrfToken } = await this.session.get(`${this.baseUrl}/api/auth/csrf`).json();

        await this.session.post(`${this.baseUrl}/api/auth/send-code`, {
            json: { email, locale: "en" },
            headers: { 'X-CSRF-Token': csrfToken, 'Referer': `${this.baseUrl}/auth/signin` }
        });

        const otp = await this.mail.waitForOTP(email);
        console.log(`[Auth] OTP Diterima: ${otp}`);

        await this.session.post(`${this.baseUrl}/api/auth/callback/email-code`, {
            body: new URLSearchParams({
                email, code: otp, redirect: "false", callbackUrl: "/en", csrfToken, json: "true"
            }).toString(),
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${this.baseUrl}/auth/signin`,
                'X-Auth-Return-Redirect': '1'
            }
        });

        const sessionData = await this.session.get(`${this.baseUrl}/api/auth/session`).json();
        if (!sessionData.user) throw new Error("Login Gagal: Session tidak valid.");
        console.log(`[Auth] Login Berhasil. Credits: ${sessionData.user.credits}`);
    }

    async uploadImage(buffer) {
        const { uploadUrl, publicUrl } = await this.session.post(`${this.baseUrl}/api/get-upload-url`, {
            json: { fileName: "image.jpg", contentType: "image/jpeg", fileSize: buffer.length }
        }).json();

        const axios = (await import('axios')).default;
        await axios.put(uploadUrl, buffer, { headers: { 'Content-Type': 'image/jpeg' } });
        return publicUrl;
    }

    async generate(prompt, imageUrls, ratio) {
        const res = await this.session.post(`${this.baseUrl}/api/generate-image`, {
            json: {
                prompt,
                styleId: "realistic",
                mode: "image",
                imageUrl: imageUrls[0],
                imageUrls: imageUrls,
                numImages: 1,
                outputFormat: "png",
                model: "nano-banana",
                aspectRatio: ratio || "auto",
                notificationSettings: { emailNotifyEnabled: false, browserNotifyEnabled: false }
            }
        }).json();

        if (!res.taskId) throw new Error("Gagal membuat Task ID.");
        const taskId = res.taskId;
        console.log(`[Job] Task Created: ${taskId}`);

        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const status = await this.session.get(`${this.baseUrl}/api/generate-image/status`, {
                searchParams: { taskId }
            }).json();

            if (status.status === 'completed') return status.imageUrl;
            if (status.status === 'failed') throw new Error(`Generate Failed: ${status.statusMessage || 'Unknown error'}`);
        }
        throw new Error("Polling Timeout");
    }
}

async function generateImageWithReference(imageSource, prompt, ratio = 'auto') {
    await initLib();
    const jar = new CookieJar();
    const proxyPath = path.join(process.cwd(), 'proxxxy.txt');
    let selectedProxy = null;

    if (fs.existsSync(proxyPath)) {
        const proxies = fs.readFileSync(proxyPath, 'utf8').split('\n').filter(Boolean);
        if (proxies.length > 0) selectedProxy = proxies[Math.floor(Math.random() * proxies.length)].trim();
    }

    const session = request.extend({
        timeout: 150000,
        cookieJar: jar,
        proxyUrl: selectedProxy || undefined,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
    });

    let buffer;
    if (imageSource.startsWith('http')) {
        const imgRes = await session.get(imageSource);
        buffer = Buffer.from(imgRes.arrayBuffer());
    } else {
        buffer = fs.readFileSync(imageSource);
    }

    const client = new ImgEditorClient(session);
    await client.login();

    const publicUrl = await client.uploadImage(buffer);
    const results = [];

    try {
        console.log("[Process] Running 1st generation...");
        const res1 = await client.generate(prompt, [publicUrl], ratio);
        results.push(res1);
    } catch (err) {
        console.error(`[Error] 1st Generation Failed: ${err.message}`);
    }

    try {
        console.log("[Process] Running 2nd generation...");
        const res2 = await client.generate(prompt, [publicUrl], ratio);
        results.push(res2);
    } catch (err) {
        console.error(`[Error] 2nd Generation Failed: ${err.message}`);
    }

    if (results.length === 0) {
        throw new Error("Gagal memproses gambar sama sekali.");
    }

    return results;
}


// --- Testing Run :
if (require.main === module) {
    const testingConfig = {
        imagePath: path.join(__dirname, 'input.jpg'),
        prompt: "Elegant cinematic portrait of a young woman with short stylish hair and round glasses sitting in a fine dining restaurant at night, holding a glass of red wine, wearing a beige knit sweater over a collared shirt, soft warm ambient lighting, city skyline with bokeh lights visible through large windows in the background, gourmet steak dish plated in front of her, luxury dining atmosphere, shallow depth of field, moody tones, natural skin texture, editorial photography style, 85mm lens, ultra-realistic, high detail, 8K.", 
        resolution: "9:16"  // auto, 1:1, 16:9, 9:16, 3:4, 4:3
    };

    if (!fs.existsSync(testingConfig.imagePath)) {
        console.error(`Error: File ${testingConfig.imagePath} tidak ditemukan!`);
    } else {
        console.log('--- Memulai Proses Testing ---');
        generateImageWithReference(testingConfig.imagePath, testingConfig.prompt, testingConfig.resolution)
            .then(result => {
                console.log('--- HASIL GENERATE ---');
                console.log(JSON.stringify(result, null, 2));
            })
            .catch(err => console.error('--- ERROR TESTING ---', err.message));
    }
}

// --- Output :
/*
--- Memulai Proses Testing ---
[Auth] Registrasi email: abcdefg@akunlama.com
[Email] Menunggu OTP untuk: abcdefg@akunlama.com...
[Auth] OTP Diterima: 163555
[Auth] Login Berhasil. Credits: 4
[Process] Running 1st generation...
[Job] Task Created: 709ba153-5e0e-4ec7-bbc7-6....
[Process] Running 2nd generation...
[Job] Task Created: ef70ef63-f266-484e-86a8-3....
--- HASIL GENERATE ---
[
  "https://file2.ilovevideo.ai/uploads/temp/6a4d.....png",
  "https://file2.ilovevideo.ai/uploads/temp/c31c.....png"
]
*/