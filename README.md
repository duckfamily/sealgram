# Sealgram

A fork of [Telegram Desktop](https://github.com/telegramdesktop/tdesktop) for
Windows, built for two reasons:

1. **A stealer that copies the `tdata` folder should not be able to use the
   account elsewhere.** Upstream derives the local encryption key from a salt
   stored in plaintext next to the data, with a single PBKDF2 iteration when no
   local passcode is set — copying the folder is enough to read everything. This
   fork mixes in a seed produced inside the machine's TPM by a key that cannot be
   exported.
2. **It has to connect from a country where Telegram is blocked.** The client
   fetches a signed list of MTProto proxies over ordinary HTTPS from a host that
   stays reachable, measures them, and switches on its own when nothing connects
   — or when messages arrive but media does not.

## Be precise about what the sealing does

It stops the data being **moved to another machine**. It does **not** stop a
process running as the same user on the same machine: the TPM key has no PIN and
no user-presence requirement, so anything running as that user can ask for the
same seed.

Setting a local passcode closes that gap — the derivation then runs 100 000
PBKDF2 iterations *and* mixes the TPM seed, so an attacker needs both the machine
and something you know. It is worth setting.

## Licence

GPLv3, like the code it is based on. `LICENSE` is included.

The changes are supplied as a patch series against an exact upstream commit
rather than as a full copy of the tree, because the tree plus its dependencies is
several gigabytes and almost none of it is ours. This is the corresponding source
for the binaries published under Releases.

## Building

```
git clone --recursive https://github.com/telegramdesktop/tdesktop.git
cd tdesktop
git checkout 12e8d4a
git am /path/to/patches/*.patch
```

Then follow upstream's `docs/building-win-x64.md`, with two differences:

- Configure with `-DDESKTOP_APP_DISABLE_AUTOUPDATE=ON`. Upstream's updater
  fetches official Telegram Desktop packages, which would replace the binary with
  one that has none of the changes below.
- Build with `--config Release -- /m:1 /p:CL_MPCount=3`. Full MSBuild parallelism
  combined with per-project `/MP` exhausts the compiler's heap and fails with
  C1076, which reads like a broken source change and is actually the machine
  running out of memory.

You will need your own `api_id` and `api_hash` from <https://my.telegram.org>,
passed as `-DTDESKTOP_API_ID=` and `-DTDESKTOP_API_HASH=`. They are not in this
repository.

`SEALGRAM.md` documents the parts of the tree that look like obvious cleanups and
are not — renaming the TPM key orphans every sealed profile, re-enabling
autoupdate replaces the binary with stock Telegram Desktop, and Qt's AUTORCC does
not notice when a file listed in a `.qrc` changes content.

## What the patches change

- **TPM sealing** — `storage/details/storage_tpm_seal.*` derives key material
  from a non-exportable RSA key in the CNG platform provider. Deterministic
  PKCS#1 v1.5 padding is used deliberately: the same input must always give the
  same signature for the result to be key material rather than a yes/no answer.
  A fallback re-seals data written before the machine had a usable TPM, so
  gaining one does not lock anybody out of their own history.
- **Process hardening** — extension-point disable, image load restrictions, heap
  termination on corruption, Arbitrary Code Guard and Code Integrity Guard,
  applied before anything else runs. `TDESKTOP_ACG=0` and `TDESKTOP_CIG=0` are
  escape hatches. CIG needs no code signing certificate: it governs images loaded
  *after* the policy is applied, and the executable is already mapped by then.
- **Auth keys in memory** — pages locked against paging, wiped with
  `OPENSSL_cleanse` because the compiler may elide a write never read again.
- **Signed proxy feed** — an Ed25519-verified list fetched over plain HTTPS,
  because a client that cannot reach Telegram cannot read a Telegram channel to
  find a proxy. Entries expire after a day.
- **Media-aware rotation** — a proxy can carry the main datacentre while refusing
  the file datacentres, so messages arrive and photos never load. Ordinary
  rotation cannot see that; this watches stalled download sessions instead.
- **Ghost mode, spy mode, ad removal** — behaviour inspired by AyuGram Desktop
  6.7.8. No code was copied; preserve both projects' GPL attribution.
- **Custom wallpapers** — images, GIFs and video behind the chat and chat list.
- **Renaming** — application name, data folder, single-instance GUID, `AppId`,
  AppUserModelId and URL scheme keys are all distinct from Telegram Desktop's, so
  both can be installed at once without fighting over them. Strings that name the
  *service* — Telegram Premium, Telegram FAQ, Telegram API — are deliberately
  untouched. This is still Telegram's network.

## Not affiliated with Telegram

This is an unofficial fork maintained by one person. It is not endorsed by or
connected with Telegram FZ-LLC. Binaries here are unsigned, so Windows SmartScreen
will warn on first run.
