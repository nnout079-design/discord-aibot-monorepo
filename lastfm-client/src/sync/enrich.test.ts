import test from "node:test";
import assert from "node:assert/strict";
import { lookupSong, songFacts } from "./bpm";
import { enrichTrack, musicBrainzLength } from "./enrich";

const json = (body: unknown, ok = true) => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));

test("songFacts keeps valid GetSongBPM fields and drops out-of-range ones", () => {
  assert.deepEqual(songFacts({ tempo: "92", time_sig: "3", key_of: "F♯m", danceability: 75, acousticness: "300", artist: { genres: ["rock"] }, album: { year: 1993 } }),
    { bpm: 92, timeSig: 3, key: "F♯m", openKey: undefined, danceability: 75, acousticness: undefined, genres: ["rock"], year: 1993 });
});

test("lookupSong prefers the exact artist/title match and needs a key", async () => {
  const results = { search: [
    { title: "Creep (Acoustic)", tempo: 90, artist: { name: "Someone" } },
    { title: "Creep", tempo: 92, key_of: "G", artist: { name: "Radiohead" } }
  ] };
  delete process.env.GETSONGBPM_API_KEY;
  assert.equal(await lookupSong({ artist: "Radiohead", name: "Creep" }, () => json(results)), null);
  process.env.GETSONGBPM_API_KEY = "k";
  let sentKey: string | null = null;
  const facts = await lookupSong({ artist: "Radiohead", name: "Creep" }, (_url, init) => {
    sentKey = new Headers(init?.headers).get("x-api-key");
    return json(results);
  });
  assert.equal(sentKey, "k");
  assert.equal(facts?.bpm, 92);
  assert.equal(facts?.key, "G");
  delete process.env.GETSONGBPM_API_KEY;
});

test("musicBrainzLength reads a recording by MBID or search and survives errors", async () => {
  const urls: string[] = [];
  const fetchImpl = (url: string | URL | Request) => { urls.push(String(url)); return json(String(url).includes("/recording/abc") ? { length: 238000 } : { recordings: [{ length: 199000 }] }); };
  assert.equal(await musicBrainzLength({ artist: "A", name: "B", mbid: "abc" }, fetchImpl), 238000);
  assert.equal(await musicBrainzLength({ artist: "A", name: "B" }, fetchImpl), 199000);
  assert.ok(urls[1].includes("query="));
  assert.equal(await musicBrainzLength({ artist: "A", name: "B" }, () => Promise.reject(new Error("down"))), undefined);
});

test("enrichTrack fills length from MusicBrainz and merges artist info without overriding the track", async () => {
  const api = { getArtistInfo: async () => ({ name: "A", tags: ["bangla", "folk"], similar: ["X", "Y"], summary: "artist bio" }) };
  const track = await enrichTrack(api as never, { name: "B", artist: "A", tags: ["world"], summary: "song wiki" }, () => json({ recordings: [{ length: 180000 }] }));
  assert.equal(track.durationMs, 180000);
  assert.deepEqual(track.artistTags, ["bangla", "folk"]);
  assert.deepEqual(track.similarArtists, ["X", "Y"]);
  assert.equal(track.summary, "song wiki");
  assert.equal(track.bpm, undefined);
});
