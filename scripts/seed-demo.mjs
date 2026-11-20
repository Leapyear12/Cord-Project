import { createPasswordHash } from '../src/server/auth.js';
import {
  pool, initDb, closeDb, createUser, createServer, addMember, createServerChannel, listChannels,
} from '../src/server/db.js';

const PASSWORD = 'cord1234';
const now = Date.now();

await initDb();

// Fresh demo state
await pool.query(`TRUNCATE messages, attachments, docs, merge_requests, merge_voters, merge_votes,
  channels, server_members, servers, sessions, users RESTART IDENTITY CASCADE`);

async function user(username) {
  const { salt, hash } = await createPasswordHash(PASSWORD);
  return createUser({ username, salt, hash });
}

const anchal = await user('anchal');
const aarav = await user('aarav');
const meera = await user('meera');
const kabir = await user('kabir');
const ishita = await user('ishita');
const rohan = await user('rohan');
const dev = await user('dev');
const priya = await user('priya');

const cord = await createServer('Chatterbox HQ', anchal.id);
for (const u of [aarav, meera, kabir, ishita, rohan, dev, priya]) await addMember(cord.id, u.id);
const design = await createServerChannel(cord.id, 'design', 'text');
const backend = await createServerChannel(cord.id, 'backend', 'text');
const random = await createServerChannel(cord.id, 'random', 'text');
const lounge = await createServerChannel(cord.id, 'Lounge', 'voice');
const standup = await createServerChannel(cord.id, 'Standup', 'voice');

const campus = await createServer('Campus Connect', meera.id);
for (const u of [anchal, aarav, kabir, ishita]) await addMember(campus.id, u.id);
const campusGeneral = (await listChannels(campus.id))[0];

async function send(channelId, userId, content, minutesAgo, edited = false) {
  const when = now - minutesAgo * 60 * 1000;
  const { rows } = await pool.query(
    'INSERT INTO messages (channel_id, user_id, content, created_at, edited_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [channelId, userId, content, when, edited ? when + 60_000 : null],
  );
  return rows[0].id;
}

const gen = (await listChannels(cord.id)).find((c) => c.name === 'general').id;
const sendGen = (userId, content, minutesAgo) => send(gen, userId, content, minutesAgo);

await sendGen(anchal.id, 'Welcome to Chatterbox HQ everyone! This is the general channel — say hi 👋', 1800);
await sendGen(aarav.id, 'Hey! The new voice channels work really well, I just tested them.', 1780);
await sendGen(meera.id, 'Loving the dark theme. Super clean and easy on the eyes.', 1760);
await sendGen(kabir.id, 'Who is joining the design review call at 5? We can use the Lounge.', 120);
await sendGen(ishita.id, 'I will be there. Sharing the new invite flow screens before the call.', 112);
await sendGen(aarav.id, 'Same here. Let us also settle the channel naming for the new server.', 96);
await sendGen(anchal.id, 'Perfect. Agenda is in the pinned message — invite links, presence, and the video grid.', 88);
await sendGen(meera.id, 'Just pushed the typing indicator fix. Try it out in #design.', 42);
await sendGen(kabir.id, 'Typing indicator looks great now. No flicker at all.', 36);
await sendGen(rohan.id, 'Anyone else seeing the online dot update instantly? That latency is nice.', 30);
await sendGen(dev.id, 'Yes, presence syncs across tabs within a second.', 24);
await sendGen(priya.id, 'The message grouping by author is a small detail but it reads so much better.', 12);
await sendGen(anchal.id, 'Thanks Priya! Credit to the 5-minute grouping window — keeps long chats tidy.', 4);

await send(design.id, ishita.id, 'New invite dialog: one link per server, 8-character code. Copy button included.', 300);
await send(design.id, meera.id, 'Can we show the code separately from the full link? Easier to read out loud.', 290);
await send(design.id, ishita.id, 'Done — the dialog now shows both.', 280, true);
await send(design.id, aarav.id, 'Looks good. Contrast on the muted text is slightly low in the sidebar.', 240);
await send(design.id, kabir.id, 'Bumped it to --text-dim #9a9ca5. Check it now.', 220);

await send(backend.id, dev.id, 'Auth is scrypt + per-user salt, sessions are opaque tokens in PostgreSQL.', 400);
await send(backend.id, rohan.id, 'We should document the socket event names somewhere. The list is getting long.', 380);
await send(backend.id, anchal.id, 'I will add them to the report appendix. message:new, voice:signal, presence:update...', 360);
await send(backend.id, dev.id, 'Also, message history paginates with a before cursor, 50 per page.', 340);

await send(random.id, priya.id, 'Coffee count today: 4. Sending help.', 200);
await send(random.id, kabir.id, 'The voice channel echo test passed with two people on the same Wi-Fi.', 180);

await send(campusGeneral.id, meera.id, 'Campus Connect is live. Use the invite code in the sidebar to join.', 600);
await send(campusGeneral.id, anchal.id, 'Joined. Sharing this with the project group.', 590);

console.log(JSON.stringify({
  password: PASSWORD,
  server: { id: cord.id, invite: cord.invite_code },
  users: ['anchal', 'aarav', 'meera', 'kabir', 'ishita', 'rohan', 'dev', 'priya'],
  channels: { gen, design: design.id, backend: backend.id, random: random.id, lounge: lounge.id, standup: standup.id },
}, null, 2));

await closeDb();
