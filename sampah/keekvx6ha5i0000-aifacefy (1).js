/* Scrape Image To Image - Aifacefy
* Base : https://aifacefy[dot]com
* Sumber : https://whatsapp.com/channel/0029VbAj9Sd47XeLArtDqO3X
* Features: Auto Register (Generator.email), Bypass Turnstile (Covenant), Support Model Ai : GPT Image 2, Seedream 5.0, Nano Banana
* Note : npm i @sptzx/request (kalo pake proxy, lebih enak pake npm ini)
* Author: ONLym-Api
* 
*/

const fs = require('fs');
const path = require('path');
const crypto = require("crypto");
const cheerio = require("cheerio");
const axios = require('axios');

// Konfigurasi API
const COVENANT_API_URL = 'https://api.covenant.sbs/api/tools/cf-turnstile';     // Bypass Turnstile-min
const COVENANT_API_KEY = 'cov_live_....';                                       // Daftar https://app.covenant.sbs/login buat dapat Apikey
const BASE_URL = "https://aifacefy.com";
const API_URL = "https://api2.aifacefy.com";

let request, CookieJar;

async function initLib() {
    if (!request) {
        const reqModule = await import('@sptzx/request');
        request = reqModule.default;
        CookieJar = reqModule.CookieJar;
    }
}

class EmailService {
    constructor() {
        this.base = 'https://generator.email/';
        this.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    async generateEmail() {
        console.log('[Email] Mendapatkan email baru dari generator.email...');
        const res = await axios.get(this.base, {
            headers: { 'User-Agent': this.ua }
        });
        const $ = cheerio.load(res.data);
        const email = $('#email_ch_text').text();
        if (!email) throw new Error("Gagal generate email");
        return email;
    }

    async waitForOTP(email, timeout = 120000) {
        const [user, domain] = email.split('@');
        const start = Date.now();
        console.log(`[Email] Menunggu OTP untuk: ${email}...`);

        while (Date.now() - start < timeout) {
            try {
                const res = await axios.get(this.base, {
                    headers: {
                        'User-Agent': this.ua,
                        'Cookie': `surl=${domain}/${user}`
                    }
                });
                const $ = cheerio.load(res.data);
                const bodyText = $("body").text().replace(/\s+/g, " ").trim();
                const otpMatch = bodyText.match(/Security code:\s*(\d{6})/i) || bodyText.match(/\b\d{6}\b/);
                if (otpMatch) {
                    const code = otpMatch[1] || otpMatch[0];
                    if (code.length === 6) return code;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 5000));
        }
        throw new Error("OTP_TIMEOUT: Kode tidak ditemukan.");
    }
}

class AifacefyClient {
    constructor(session, jar) {
        this.session = session;
        this.jar = jar; 
        this.mail = new EmailService();
        this.token = null;
    }

    async bypassTurnstile() {
        console.log('[Bypass] Meminta Token Turnstile dari Covenant...');
        try {
            const { data } = await axios.post(COVENANT_API_URL, {
                url: BASE_URL,
                siteKey: "0x4AAAAAACpy-nnUBpQE1s_0",
                mode: "turnstile-min"
            }, {
                headers: { 
                    'x-api-key': COVENANT_API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            if (!data.status) throw new Error(data.message);
            const token = data.data?.token;
            console.log('[Bypass] Token Turnstile Berhasil Didapatkan.');
            return token;
        } catch (e) {
            throw new Error(`Bypass Gagal: ${e.message}`);
        }
    }

    async registerAndLogin() {
        const email = await this.mail.generateEmail();
        const username = email.split('@')[0];
        const password = "@Rbonlym123"; // Custom Password Sign Up

        const cfToken = await this.bypassTurnstile();

        console.log(`[Auth] Registrasi email: ${email}`);
        await this.session.post(`${BASE_URL}/`, {
            headers: { 
                'Next-Action': '1bfdfe2d4070d78f8a19cdc9b6b7fdaabab00b95',
                'Content-Type': 'text/plain;charset=UTF-8'
            },
            body: JSON.stringify([{ email, userName: username, password, cfToken, src: "", via: "", ipAddress: "1.1.1.1", countryCode: "ID" }])
        });

        const otp = await this.mail.waitForOTP(email);
        console.log(`[Auth] OTP Diterima: ${otp}`);

        await this.session.post(`${BASE_URL}/`, {
            headers: { 
                'Next-Action': 'efbaa6169049c8cb5fd4fd1abe810d880738ab19',
                'Content-Type': 'text/plain;charset=UTF-8'
            },
            body: JSON.stringify([{ email, emailCode: otp }])
        });

        console.log('[Auth] Melakukan Login...');
        const loginRes = await this.session.post(`${BASE_URL}/`, {
            headers: { 
                'Next-Action': '1c7778f900ce2db3f2c455a90e709ef29ae30db3',
                'Content-Type': 'text/plain;charset=UTF-8'
            },
            body: JSON.stringify([{ email, password }])
        });

        const rawResponse = await loginRes.text();
        const tokenMatch = rawResponse.match(/Bearer\s+(ey[a-zA-Z0-9._-]+)/i);
        
        if (tokenMatch) {
            this.token = `Bearer ${tokenMatch[1]}`;
        } else {
            const setCookie = loginRes.headers.get('set-cookie') || "";
            const headerToken = setCookie.match(/Authorization=Bearer%20(ey[a-zA-Z0-9._-]+)/i) ||
                               setCookie.match(/access_token%22%3A%22(ey[a-zA-Z0-9._-]+)/i);
            
            if (headerToken) {
                this.token = `Bearer ${decodeURIComponent(headerToken[1])}`;
            } else {
                try {
                    const cookieMap = this.jar.cookies || this.jar._cookies || {};
                    const authCookie = JSON.stringify(cookieMap).match(/Bearer%20(ey[a-zA-Z0-9._-]+)/i);
                    if (authCookie) {
                        this.token = `Bearer ${decodeURIComponent(authCookie[1])}`;
                    } else {
                        throw new Error("Gagal mengekstrak Bearer Token.");
                    }
                } catch (e) {
                    throw new Error("Gagal mendapatkan Bearer Token.");
                }
            }
        }

        console.log('[Auth] Login Berhasil!');
        return this.token;
    }

    async uploadImage(imageBuffer) {
        console.log('[Upload] Mendapatkan Presigned URL...');
        const preRes = await this.session.post(`${API_URL}/image/presignedUrl`, {
            json: { site: "aifacefy.com", mineType: ["image/jpeg"] },
            headers: { 'authorization': this.token }
        });
        const preData = await preRes.json();
        const { signedUrl, url } = preData.rows[0];

        console.log('[Upload] Mengunggah file ke storage...');
        await axios.put(signedUrl, imageBuffer, {
            headers: { 'Content-Type': 'image/jpeg' }
        });

        return url;
    }

    async generate(options) {
        const { prompt, imageUrl, model = "seedream-v5-0-edit", ratio = "9:16", resolution = "4k" } = options; // Seedream 5.0 Default Ratio 9:16 Resolusi 4k
        const payload = {
            site: "aifacefy.com",
            imageType: "ai-image-generator",
            prompt,
            platformType: 39,
            modelName: model,
            isPublic: 1,
            imageUrlList: imageUrl ? [imageUrl] : [],
            width: parseInt(ratio.split(':')[0]),
            height: parseInt(ratio.split(':')[1]),
            ratio,
            supportRatio: true,
            resolution: resolution,
            nsfwFilter: false
        };

        console.log(`[Generate] Membuat tugas dengan model: ${model} [${resolution}]`);
        const res = await this.session.post(`${API_URL}/image/generator4login/async`, {
            json: payload,
            headers: { 'authorization': this.token }
        });
        
        const data = await res.json();
        if (data.code !== 200) throw new Error(data.msg || "Gagal membuat task");
        return data.data.key;
    }

    async waitTask(key) {
        console.log(`[Task] Menunggu hasil (Key: ${key})...`);
        const start = Date.now();
        while (Date.now() - start < 600000) { 
            const res = await this.session.get(`${API_URL}/image/getResult/${key}`, {
                searchParams: { site: "aifacefy.com" },
                headers: { 'authorization': this.token }
            });
            const data = await res.json();
            
            if (data.data?.status === "completed" || data.data?.status === "success") {
                const listRes = await this.session.get(`${API_URL}/image/myList`, {
                    searchParams: { pageNum: 1, pageSize: 1, site: "aifacefy.com" },
                    headers: { 'authorization': this.token }
                });
                const listData = await listRes.json();
                return listData.rows[0]?.url;
            }
            if (data.data?.status === "failed") throw new Error("Task gagal di server");
            console.log(`[Task Status] ${data.data?.status || 'Processing'}...`);
            await new Promise(r => setTimeout(r, 10000));
        }
        throw new Error("TIMEOUT: Generate terlalu lama.");
    }
}

// --- Testing Run :
(async () => {
    try {
        await initLib();
        const jar = new CookieJar();
        const proxyPath = path.join(process.cwd(), 'proxies.txt');      // Pastikan Nama proxy nya proxies.txt
        let proxyUrl = null;

        if (fs.existsSync(proxyPath)) {
            const proxies = fs.readFileSync(proxyPath, 'utf8').split('\n').filter(Boolean);
            if (proxies.length > 0) proxyUrl = proxies[Math.floor(Math.random() * proxies.length)].trim();
            console.log(`[System] Menggunakan Proxy: ${proxyUrl}`);
        }

        const session = request.extend({
            timeout: 120000,
            cookieJar: jar,
            proxyUrl: proxyUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
                'Origin': BASE_URL,
                'Referer': BASE_URL + '/'
            }
        });

        const client = new AifacefyClient(session, jar);

        await client.registerAndLogin();

        const targetImagePath = path.join(__dirname, 'input.jpg');
        if (!fs.existsSync(targetImagePath)) throw new Error("File input.jpg tidak ditemukan!");
        
        const imageBuf = fs.readFileSync(targetImagePath);
        const uploadedUrl = await client.uploadImage(imageBuf);

        // Custom Prompt :
        const prompt = " ";
        
        const resultUrl = await client.generate({
            prompt: prompt,
            imageUrl: uploadedUrl,
            model: "seedream-v5-0-edit",    // Model : gpt-image-2-low-edit, seedream-v5-0-edit, nano-banana-ai
            ratio: "9:16",                  // 1:1, 16:9, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 21:9
            resolution: "4k"                // Resolusi :  "1k", "2k" atau "4k" 
                                            // (model GPT image 2 sama Nano Banana cuman bisa 1k, kalo Seedream 5 cuma bisa 2k atau 4k)
        }).then(key => client.waitTask(key));

        console.log('--- HASIL GENERATE ---');
        console.log(JSON.stringify({
            status: true,
            creator: "ONLym-Api",
            result: resultUrl
        }, null, 2));

    } catch (err) {
        console.error('--- ERROR ---');
        console.error(err.message);
    }
})();

// --- Output :
/*
[System] Menggunakan Proxy: 142.147.128.****:zik****:sbfv*****
[Email] Mendapatkan email baru dari generator.email...
[Bypass] Meminta Token Turnstile dari Covenant...
[Bypass] Token Turnstile Berhasil Didapatkan.
[Auth] Registrasi email: abuhanesh@ttpo89japan.com
[Email] Menunggu OTP untuk: abuhanesh@ttpo89japan.com...
[Auth] OTP Diterima: 205276
[Auth] Melakukan Login...
[Auth] Login Berhasil!
[Upload] Mendapatkan Presigned URL...
[Upload] Mengunggah file ke storage...
[Generate] Membuat tugas dengan model: seedream-v5-0-edit [4k]
[Task] Menunggu hasil (Key: 2049480386209849344)...
[Task Status] await...
[Task Status] await...
[Task Status] await...
[Task Status] await...
[Task Status] await...
--- HASIL GENERATE ---
{
  "status": true,
  "creator": "ONLym-Api",
  "result": "https://img.artiversehub.ai/online/2026/4/29/......71555.jpeg"
}
*/