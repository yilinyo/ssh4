# ssh4

`ssh4` is a small npm-based CLI for passwordless SSH setup.

## Install

```bash
npm install -g @yilinyo/ssh4
```

## Usage

Generate a key pair:

```bash
ssh4 client generate prod
```

Add the public key to a server:

```bash
ssh4 host add prod --host example.com --user root --test
```

After setup, connect directly with:

```bash
ssh prod
```

List saved aliases:

```bash
ssh4 list
```

Remove a saved alias:

```bash
ssh4 rm prod
```

If you want to choose a custom key path:

```bash
ssh4 client generate prod --path ~/.ssh/ssh4/prod/id_ed25519
ssh4 host add prod --user ubuntu
```

## Notes

- `ssh4 client genrate` is accepted as a typo-friendly alias for `generate`.
- The tool uses `ssh-keygen` and `ssh` from your system.
- If `ssh-copy-id` exists on your machine, `ssh4 host add` will use it automatically.
- Each alias gets its own key directory under `~/.ssh/ssh4/<alias>/`.
- `ssh4 host add` requires `ssh4 client generate <alias>` to run first so the public key exists.
- `ssh4 host add <alias> --host ...` writes host info into the alias folder on first use, then reuses it later without `--host`.
- `ssh4 host add` defaults to `root` if you do not pass `--user`, but the CLI will tell you to pass it explicitly.
- `ssh4 host add` also updates `~/.ssh/config` so `ssh <alias>` can connect directly.
- `ssh4 list` scans `~/.ssh/ssh4/` directly, and `ssh4 rm <alias>` removes one alias plus its local key directory.
