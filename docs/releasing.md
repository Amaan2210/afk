# Releasing

One tag releases both halves. Pushing `vX.Y.Z` runs `.github/workflows/release.yml`, whose `npm`
job publishes `afkdev` X.Y.Z to npm with provenance and whose `android` job builds the release
APK, signs it and attaches it as `afk-vX.Y.Z.apk` to the GitHub Release for the tag. Each job
refuses a tag whose version differs from the one in its files, so a mistyped tag fails instead of
publishing the wrong version.

## Once: the Android signing key

Android installs an update only over an app signed with the same key, so the key is the app's
identity for everyone who installed it. If it is lost, every user has to uninstall to update,
which forgets their pairing. Keep the keystore outside the repository, back it up somewhere
private, and never commit it. The repository secrets are the only copy CI sees.

The commands below are PowerShell. From a cmd window, type `powershell` first. The keytool line
also works in cmd on one line, with `%USERPROFILE%` in place of `$env:USERPROFILE` and no
backticks.

1. **Create the keystore** with `keytool` from the Android Studio JDK. It asks for a keystore
   password; pick one in a password manager first. At the key password prompt press Enter: the
   keystore is PKCS12, the JDK default, and a PKCS12 key cannot have a password of its own, so
   the key password is the keystore password.

   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
     -keystore "$env:USERPROFILE\afk-release.jks" -alias afk `
     -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=AFK, O=AmaanKhan63"
   ```

2. **Copy the keystore as base64** to the clipboard, without printing it:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\afk-release.jks")) |
     Set-Clipboard
   ```

3. **Add four repository secrets** on GitHub, under Settings → Secrets and variables → Actions:

   | Secret                      | Value                                   |
   | --------------------------- | --------------------------------------- |
   | `ANDROID_KEYSTORE_B64`      | the clipboard from step 2               |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password                   |
   | `ANDROID_KEY_ALIAS`         | `afk`, the alias from step 1            |
   | `ANDROID_KEY_PASSWORD`      | the key password                        |

   The `npm` job needs `NPM_TOKEN` as well: an npm granular access token allowed to publish
   `afkdev`.

4. **Check the signature locally** if you want to. In a fresh PowerShell window that you close
   afterwards, from `android/`. `Read-Host` asks for the password on the spot, so it never goes
   into the shell's history file:

   ```powershell
   $env:AFK_KEYSTORE_PATH = "$env:USERPROFILE\afk-release.jks"
   $env:AFK_KEY_ALIAS = "afk"
   $env:AFK_KEYSTORE_PASSWORD = Read-Host "Keystore password"
   $env:AFK_KEY_PASSWORD = $env:AFK_KEYSTORE_PASSWORD
   .\gradlew :app:assembleRelease
   & "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs `
     app\build\outputs\apk\release\app-release.apk
   ```

   The last line of the output names your certificate, `CN=AFK, O=AmaanKhan63`, not
   `CN=Android Debug`. Without the four variables the same command signs with the debug key, as
   CI does when the secrets are missing; the release job then prints a warning, and that APK will
   not install over a build signed with the real key. The APK this step leaves behind carries the
   release key, so it is the right build to install for the QA pass: the first release then
   installs over it without losing the pairing.

## Every release

1. **Bump the version** in both places, to the same value: `version` in `service/package.json`
   and `versionName` in `android/app/build.gradle.kts`. Raise `versionCode` by one there as well:
   Android refuses to install a build whose code is lower than the installed one.
2. **Date the changelog**: in `CHANGELOG.md`, turn the Unreleased section into a `X.Y.Z` section
   with the date.
3. **Commit, tag and push** the branch and the tag together:

   ```powershell
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. **Watch the workflow** on the Actions tab. When it finishes, the Release page for the tag has
   `afk-vX.Y.Z.apk`, with generated release notes, and `npm view afkdev version` prints X.Y.Z.
   If a job failed, fix the cause, delete the tag locally and on GitHub, and tag again; the
   workflow runs only on a tag push. If the `android` job warned that no keystore secret is set,
   the APK on the release is debug-signed: add the secrets and re-run the job from the Actions
   tab, which replaces the asset.
5. **Install the released APK** on a phone over the previous release to confirm the key matches.
   The first real-key release does not install over a debug-signed build: uninstall that one
   first, which forgets the pairing.
