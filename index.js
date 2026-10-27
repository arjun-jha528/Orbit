import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool, initDb } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');
const JWT_SECRET = process.env.JWT_SECRET;
const AI_ENDPOINT = 'https://vireonix.ai/v1/chat/completions';

app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));

async function getFreeAIReply(messages) {
  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'auto', messages, stream: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 429
      ? 'Orbit is busy right now because the free AI service has reached its usage limit. Please try again later.'
      : 'The free AI service is temporarily unavailable. Please try again later.');
    error.status = response.status === 429 ? 429 : 503;
    throw error;
  }
  return data.choices?.[0]?.message?.content || 'I could not form a useful answer this time. Please try again.';
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !JWT_SECRET) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Orbit AI' }));

app.post('/api/auth/signup', async (req, res, next) => {
  try {
    if (!JWT_SECRET) return res.status(503).json({ error: 'Server setup is incomplete: JWT_SECRET is missing.' });
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter your name and a valid email address.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email',
      [name, email, passwordHash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '14d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists. Please sign in.' });
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (!JWT_SECRET) return res.status(503).json({ error: 'Server setup is incomplete: JWT_SECRET is missing.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const result = await pool.query('SELECT id,name,email,password_hash FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '14d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
});

app.get('/api/me', authRequired, (req, res) => res.json({ user: req.user }));

app.get('/api/chats', authRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id,title,updated_at FROM chats WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 40',
      [req.user.id]
    );
    res.json({ chats: result.rows.map(row => ({ id: row.id, title: row.title, updatedAt: row.updated_at })) });
  } catch (err) { next(err); }
});

app.get('/api/chats/:id', authRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id,title,messages FROM chats WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

app.delete('/api/chats/:id', authRequired, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/chat', authRequired, async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim();
    const image = req.body?.image;
    if (image?.data) return res.status(501).json({ error: 'Image understanding is not included in Orbit’s current free, no-key AI setup. Text chat is ready; image support needs a separate compatible service.' });
    if (!message) return res.status(400).json({ error: 'Type a message to chat with Orbit.' });
    if (message.length > 12000) return res.status(400).json({ error: 'Please shorten your message to 12,000 characters or fewer.' });

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 5000)
        }))
      : [];

    const answer = await getFreeAIReply([
      { role: 'system', content: "You are Orbit, a helpful AI assistant. Reply in the user's language, using simple, natural language. Explain clearly and adapt the depth to the question. Be honest about uncertainty. For schoolwork, teach step by step. You cannot see images in this version." },
      ...history,
      { role: 'user', content: message }
    ]);
    const chatId = req.body?.chatId && /^[0-9a-f-]{36}$/i.test(req.body.chatId) ? req.body.chatId : randomUUID();
    const title = (message || 'Image conversation').slice(0, 70);
    const previous = await pool.query('SELECT messages,title FROM chats WHERE id=$1 AND user_id=$2', [chatId, req.user.id]);
    const previousMessages = previous.rows[0]?.messages || history;
    const messages = [
      ...previousMessages,
      { role: 'user', content: message || 'Please describe this image.', imageUrl: undefined },
      { role: 'assistant', content: answer }
    ].slice(-40);
    await pool.query(
      `INSERT INTO chats(id,user_id,title,messages,updated_at) VALUES($1,$2,$3,$4,NOW())
       ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,messages=EXCLUDED.messages,updated_at=NOW()
       WHERE chats.user_id=EXCLUDED.user_id`,
      [chatId, req.user.id, previous.rows[0]?.title || title, JSON.stringify(messages)]
    );
    res.json({ answer, chatId });
  } catch (err) { next(err); }
});

app.post('/api/image', authRequired, async (_req, res) => {
  res.status(501).json({ error: 'Image generation is not included in the free, no-key setup. A separate image-generation provider would be needed.' });
});

app.use((err, _req, res, _next) => {
  console.error('Orbit API error:', err?.message || err);
  const status = Number(err?.status) || 500;
  const message = status < 500 || status === 429 || status === 503 ? err.message : 'Orbit hit a server error. Check the Render logs and environment settings.';
  res.status(status).json({ error: message });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Orbit listening on ${PORT}`));
}).catch(err => {
  console.error('Could not initialize Orbit database:', err);
  process.exit(1);
});
