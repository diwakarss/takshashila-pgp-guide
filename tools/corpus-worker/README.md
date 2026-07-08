# Corpus delivery worker

Serves the private pgp-brain corpus to student apps, gated by the cohort
passphrase. Live at `https://pgp-corpus.diwakar-s-s.workers.dev`.

- `GET /manifest.json` — every published file with a content hash
- `GET /f/pgp/<file>.md`, `GET /f/illustrations/<path>` — the files
- Auth on everything: `Authorization: Bearer <cohort passphrase>`
  (Worker secret `CORPUS_KEY`; the builder's copy lives in
  `~/.pgp-ingest/corpus-key.txt`)

Storage is Workers KV (namespace `CORPUS`) — the account has no R2; KV's
25 MB/value cap is far above our biggest file and the free 1 GB holds years
of corpus growth. Swap to R2 later by changing the binding + publisher only.

**Publishing** happens from the pgp-brain repo: `node tools/publish/publish.mjs`
diffs the local corpus against the live manifest and bulk-uploads only the
delta (manifest last, so clients never see unlisted files). Run it after the
weekly ingest, or add `--dry-run` to preview.

**Student flow in the app**: first-run wizard (or Settings → Course library)
takes the class passphrase → `syncCorpus()` mirrors changed files into
`userData/corpus/` → incremental import embeds only what's new → brain pages
whose files disappeared are pruned. The sidebar "N new" badge checks the live
manifest against the local mirror.

Rotating the passphrase: `npx wrangler secret put CORPUS_KEY` here, update
`~/.pgp-ingest/corpus-key.txt`, tell students the new phrase (Settings →
Course library → Class passphrase).
