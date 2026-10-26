# Setting up GitHub storage

By default ModoTorneo keeps your tournaments in this browser only. With GitHub storage, every
change is saved as a commit to a private GitHub repository that you own. Your data then has a full
history and is available on any device where you connect.

You need a GitHub account. Setup takes about five minutes.

## 1. Find your GitHub account name

Sign in to GitHub and click your profile picture in the top right corner. The name shown under
"Signed in as" is your account name, for example `MaxCej`. This is the **owner** you will enter in
ModoTorneo.

Use the account name, not your display name and not the name in your local git settings
(`git config user.name`). They can differ.

## 2. Create the data repository

1. Go to <https://github.com/new>.
2. **Owner:** your account.
3. **Repository name:** for example `mtg-data`.
4. Choose **Private**. A public repository works, but anyone can then read your players' names.
5. Click **Create repository**. The repository can stay empty: ModoTorneo creates its files on the
   first save.

The repository's address is `https://github.com/<owner>/<repository>`, for example
`https://github.com/MaxCej/mtg-data`.

## 3. Create a fine-grained token

The token lets ModoTorneo read and write this one repository and nothing else.

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Token name:** for example `ModoTorneo`.
3. **Resource owner:** your account.
4. **Expiration:** a date you are comfortable with. When the token expires, create a new one and
   connect again.
5. **Repository access:** choose **Only select repositories**, then pick your data repository in
   the **Select repositories** list. It must appear in the list under the picker.
6. **Permissions:** click **Add permissions**, choose **Contents**, and close the list. Contents now
   shows with an **Access** setting of **Read-only**: change it to **Read and write**.
   **Metadata: Read-only** is added automatically. Add nothing else.
7. Check the summary at the bottom of the page. It must show access to one repository, with read
   and write access to code. If you skip step 6, GitHub saves the token with access to public
   repositories only, and ModoTorneo cannot find a private repository.
8. Click **Generate token** and copy it. GitHub shows it only once. It starts with `github_pat_`.

Keep the token secret: anyone who has it can change your data repository. Never paste it into a
chat, an issue or a file.

## 4. Connect ModoTorneo

1. Before connecting, if you already have tournaments in this browser and want them on GitHub,
   open **Data** and export a full backup.
2. Open **Settings**.
3. **Owner:** your account name only, for example `MaxCej`.
4. **Repository:** the repository name only, for example `mtg-data`. Do not enter `owner/name`, a
   URL or `.git`.
5. **Fine-grained token:** paste the token.
6. Click **Test connection**. It must say "Connected to owner/repository." **Connect** stays
   disabled until the test passes.
7. Click **Connect**. The app reloads and now reads and writes the repository.
8. If you exported a backup in step 1, open **Data** and import it.

Settings and Data now show "Storage: GitHub (owner/repository)". The token is stored only in this
browser. Repeat this section on every device or browser you use.

## Test connection messages

| Message                                                 | What to do                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connected to owner/repository.                          | Click **Connect**.                                                                                                                                                        |
| Connected … This repository is public                   | Works, but player names are public. Make the repository private in its GitHub settings if you prefer.                                                                     |
| The token was rejected.                                 | The token is wrong, expired or deleted. Copy it again or create a new one.                                                                                                |
| Repository not found, or the token has no access to it. | Check the owner and repository spelling (step 1 and section 4), that the repository is selected in the token, and that the token has **Contents** (section 3, steps 5–7). |
| The token cannot write to this repository.              | Set **Contents** to **Read and write** on the token.                                                                                                                      |
| Cannot reach GitHub: …                                  | Check your internet connection and try again.                                                                                                                             |

## Disconnecting

Open **Settings** and click **Disconnect**. The app removes the token from this browser and goes
back to browser storage. Nothing is deleted from the repository or from this browser. To revoke
access completely, also delete the token at <https://github.com/settings/personal-access-tokens>.
