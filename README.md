# LearnHub

A personal learning site. Courses are written as code in this repo; progress, quiz scores and
study-session time sync through Firebase.

- Progress bar per course, chapter completion gated on a 5-question quiz
- Start/pause study timer in the top-right, with session history on the profile page
- Streaks, per-course time breakdown, weekly activity
- Dark and light themes, keyboard shortcuts, mobile-friendly
- Designed to sit inside the **Firebase free tier**: content is bundled, so a full app session
  costs a handful of document reads

First course: **Retrieval-Augmented Generation** — 10 chapters, 50 questions.

---

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Firebase configured it starts in **local mode**: progress is stored in the browser and
everything works. Add the keys below when you want cross-device sync.

## Set up Firebase (once)

1. Create a project at <https://console.firebase.google.com> (Spark / free plan is fine).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
   Add your deploy domain under *Authorized domains* later.
3. **Build → Firestore Database → Create database → Production mode.** Pick a region near you;
   it cannot be changed afterwards.
4. **Project settings → General → Your apps → Web (`</>`)** → register an app → copy the config.
5. Create `.env.local` from `.env.example` and paste the values in.
6. Put your project ID in `.firebaserc`.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules      # do this before first use
```

## Deploy

```bash
npm run deploy       # validate -> type-check -> build -> firebase deploy
```

Then add the hosting domain to **Authentication → Settings → Authorized domains**, or Google
sign-in will fail on the live site.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run validate` | Check every course against the content contract |
| `npm run build` | Validate, type-check, build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run deploy` | Build and push to Firebase Hosting |

## Adding a course

Read **[AUTHORING.md](./AUTHORING.md)**. Short version: create
`src/content/courses/<id>/` with `meta.ts`, `course.ts` and `chapters/*.ts`, then run
`npm run validate`. The site picks it up automatically — there is no registry to edit.

For how the whole thing fits together, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `space` | Start / pause the study timer |
| `j` / `k` | Next / previous chapter |
| `1`–`4` | Answer the current quiz question |
| `Enter` | Advance after answering |
| `←` / `→` | Move through flashcards |
