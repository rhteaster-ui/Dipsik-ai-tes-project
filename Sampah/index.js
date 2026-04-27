// api/index.js
import axios from 'axios';

// Fungsi utama dari request kamu (Tetap pakai algoritma asli Bang San)
async function turboseekLogic(question) {
    try {
        if (!question) throw new Error('Question is required.');
        
        const inst = axios.create({
            baseURL: 'https://www.turboseek.io/api',
            headers: {
                origin: 'https://www.turboseek.io',
                referer: 'https://www.turboseek.io/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        // 1. Get Sources
        const { data: sources } = await inst.post('/getSources', {
            question: question
        });
        
        // 2. Get Similar Questions
        const { data: similarQuestions } = await inst.post('/getSimilarQuestions', {
            question: question,
            sources: sources
        });
        
        // 3. Get Answer
        const { data: answer } = await inst.post('/getAnswer', {
            question: question,
            sources: sources
        });
        
        // Cleaning answer logic as provided
        const cleanAnswer = answer.match(/<p>(.*?)<\/p>/gs)?.map(match => {
            return match.replace(/<\/?p>/g, '').replace(/<\/?strong>/g, '').replace(/<\/?em>/g, '').replace(/<\/?b>/g, '').replace(/<\/?i>/g, '').replace(/<\/?u>/g, '').replace(/<\/?[^>]+(>|$)/g, '').trim();
        }).join('\n\n') || answer.replace(/<\/?[^>]+(>|$)/g, '').trim();
        
        return {
            answer: cleanAnswer,
            sources: sources.map(s => s.url), // Mengambil URL saja
            similarQuestions
        };
    } catch (error) {
        throw error;
    }
}

// Vercel Serverless Handler (Versi ES Modules - Anti Error)
export default async function handler(req, res) {
    // Handle CORS biar bisa diakses dari frontend mana aja
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    
    // Tangkap request pre-flight dari browser
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { question } = req.query || req.body;

    if (!question) {
        return res.status(400).json({ error: 'Please provide a question' });
    }

    try {
        const result = await turboseekLogic(question);
        return res.status(200).json(result);
    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: error.message });
    }
            } 
