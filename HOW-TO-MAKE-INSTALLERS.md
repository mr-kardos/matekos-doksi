# Making the installers – no terminal needed

GitHub builds the Windows and Mac installers for you, for free, in about 20 minutes.
You only do this once per new version.

## 1. Put the project on GitHub
1. Create a free account at https://github.com and sign in.
2. Click **+** (top right) → **New repository**. Name it `matekos-doksi`.
   Choose **Public** (then your peers can download without an account), and click **Create repository**.
3. On the next page click **uploading an existing file**.
4. Unzip `matekos-doksi-0.2-source.zip`, open the `matekos-doksi` folder, select **everything inside it**
   and drag it into the browser window. Wait until all files are listed, then click **Commit changes**.

## 2. Add the build recipe
Folders starting with a dot are often hidden, so add this one by hand:
1. In the repository click **Add file → Create new file**.
2. As the file name type exactly: `.github/workflows/build.yml`
3. Open `WORKFLOW-build.yml` (from the zip) in Notepad / TextEdit, copy everything, and paste it into the big box.
4. Click **Commit changes**.

## 3. Build
1. Open the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
2. Click **Build installers** on the left → **Run workflow** → **Run workflow**.
3. Wait for both green ticks (Windows and macOS), about 15–25 minutes.

## 4. Share
Open **Releases** (right side of the repository's main page). The newest release has:
* `Matekos.Doksi_0.3.1_x64-setup.exe` – Windows installer wizard
* `Matekos.Doksi_0.3.1_universal.dmg` – Mac (Apple Silicon and Intel)

Send your peers the link to that Releases page. The installation steps are written there in Hungarian and English.

## New version later
Change `"version"` in `src-tauri/tauri.conf.json` (e.g. to `0.3.1`), upload the changed files, and run step 3 again.

## About the security warnings
The app is not yet "signed", so Windows and macOS show a one-time warning on first launch.
That's normal for small projects. To remove it you need a code-signing certificate
(Apple Developer Program: 99 USD/year; Windows: a code-signing certificate from a provider).
