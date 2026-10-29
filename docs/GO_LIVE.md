# Go live in about 15 minutes (no programming needed)

This guide puts FUELTRACK on the internet with **Render**, a hosting service that builds and runs the app for you from this GitHub repository. You only click buttons and type one password.

## What you need

- The GitHub account that owns this repository
- An email address for a Render account
- A payment card for the always-on plan: roughly **US$13–15 per month** for the app and database together. Check the current prices on Render's pricing page.

> **Why not free?** Render's free database is **deleted after 30 days**, and the free app sleeps after 15 minutes without visitors (about a minute to wake up). That is fine for a short trial but not for official records. For a trial, change both `plan:` lines in `render.yaml` to `free` before deploying.

## Step 1: Create a Render account

1. Go to <https://render.com> and click **Get Started**.
2. Choose **Sign up with GitHub** and allow Render to see your repositories. If GitHub asks which repositories, include **FUEL-REQUISITION-AND-LOG-BOOK**.

## Step 2: Deploy

1. Click this button (or open the link while signed in to Render):

   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/marioibay19-tech/FUEL-REQUISITION-AND-LOG-BOOK)

   Link: `https://render.com/deploy?repo=https://github.com/marioibay19-tech/FUEL-REQUISITION-AND-LOG-BOOK`

2. Render reads the `render.yaml` file and lists what it will create:
   - **fueltrack**: the web app
   - **fueltrack-db**: the PostgreSQL database
3. Give the blueprint a name (for example `FUELTRACK`) and fill in the one empty box:
   - **SEED_ADMIN_PASSWORD**: the first administrator's password. Use **at least 10 characters with letters and numbers**, for example `Fuel2026Admin!`. You will change it at first sign-in.
4. Click **Apply** (or **Deploy Blueprint**) and add your payment card if asked.

The first build takes about 5–10 minutes. Watch progress under **Dashboard → fueltrack → Events / Logs**. It is ready when the log shows:

```
FUELTRACK API listening on http://localhost:10000 (production)
```

(the port number may differ).

## Step 3: Open the app

1. In Render, open the **fueltrack** service. At the top is your web address, for example `https://fueltrack-xxxx.onrender.com`.
2. Open it and sign in:
   - Username: **admin**
   - Password: the one you typed in Step 2
3. The app asks you to choose a new password. Do it, and keep the new password safe.

## Step 4: Set it up for your office (inside the app)

Follow these screens in order (details in [ADMIN_GUIDE.md](ADMIN_GUIDE.md)):

1. **System Settings → Rules**: agency and office names for report headers; review the workflow rules.
2. **System Settings → Fuel types**: check the default prices.
3. **User Management**: add the approving officers, fuel custodians and requesters, with their office and roles.
4. **System Settings → Offices and divisions**: add your offices and choose each one's default approving officer.
5. **Vehicle Management → Register vehicle**: add each vehicle with its **current odometer reading**.

Give each person their username and temporary password. Everyone is asked to choose their own password at first sign-in.

## Everyday care

| Task | How |
|---|---|
| **Backups** | Paid Render databases are backed up daily by Render (see *fueltrack-db → Recovery*). For extra safety, download a backup monthly from that page and keep it off-site. Uploaded receipts are stored in the database, so they are included. |
| **Updates** | When new code is merged into `main` on GitHub, Render rebuilds and restarts the app automatically. Database changes are applied on start. |
| **Forgotten admin password** | Another administrator can reset it in User Management. Create at least two administrator accounts so you are never locked out. |
| **Your own address** (e.g. `fuel.youroffice.gov.ph`) | Render → fueltrack → **Settings → Custom Domains**, then add the record Render shows at your domain provider. Render provides the HTTPS certificate. |
| **Something broke** | Render → fueltrack → **Logs** shows errors. **Manual Deploy → Deploy latest commit** restarts the app without losing data. |

## Important

- Do **not** set `SEED_DEMO_DATA` to `true` on this server. Demo records cannot be deleted later, because fuel records are protected from deletion.
- The data in this system is official. Before real use, have your IT or records officer review the setup, and run a short trial with real users.

## If something goes wrong during deploy

| Message in the logs | Fix |
|---|---|
| `Set SEED_ADMIN_PASSWORD (at least 10 characters)` | Render → fueltrack → **Environment** → edit `SEED_ADMIN_PASSWORD` to a longer password → **Save, rebuild and deploy** |
| `Can't reach database server` | Wait until **fueltrack-db** shows *Available*, then **Manual Deploy → Deploy latest commit** |
| Build failed | Open the log, copy the last 30 lines, and ask for help (for example in a new Claude session with this repository) |
