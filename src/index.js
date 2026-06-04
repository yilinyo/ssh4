import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

function print(line = "") {
  process.stdout.write(`${line}\n`);
}

function printErr(line = "") {
  process.stderr.write(`${line}\n`);
}

function exit(code = 0) {
  process.exit(code);
}

function homeDir() {
  return os.homedir();
}

function expandTilde(input) {
  if (!input) return input;
  if (input === "~") return homeDir();
  if (input.startsWith("~/")) return path.join(homeDir(), input.slice(2));
  return input;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.stdio ?? "inherit",
    env: process.env,
    cwd: options.cwd,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const value = String(answer).trim().toLowerCase();
      resolve(value === "y" || value === "yes");
    });
  });
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = {};
  const positionals = [];

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;
    if (token === "--") {
      positionals.push(...args);
      break;
    }
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const key = token.slice(2, eqIndex);
        const value = token.slice(eqIndex + 1);
        flags[key] = value;
        continue;
      }
      const key = token.slice(2);
      const next = args[0];
      if (next && !next.startsWith("-")) {
        flags[key] = args.shift();
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const key = token.slice(1);
      const next = args[0];
      if (next && !next.startsWith("-")) {
        flags[key] = args.shift();
      } else {
        flags[key] = true;
      }
      continue;
    }
    positionals.push(token);
  }

  return { flags, positionals };
}

function defaultKeyDir() {
  return process.env.SSH4_KEY_DIR
    ? path.resolve(expandTilde(process.env.SSH4_KEY_DIR))
    : path.join(homeDir(), ".ssh", "ssh4");
}

function sshConfigPath() {
  return path.join(homeDir(), ".ssh", "config");
}

function normalizeAlias(alias) {
  if (!alias || typeof alias !== "string") return "";
  const cleaned = alias.trim();
  if (!cleaned) return "";
  if (cleaned.includes("/") || cleaned.includes("\\") || cleaned === "." || cleaned === "..") {
    return "";
  }
  return cleaned;
}

function defaultKeyPathForAlias(alias) {
  const safeAlias = normalizeAlias(alias);
  if (!safeAlias) return "";
  return path.join(defaultKeyDir(), safeAlias, "id_ed25519");
}

function aliasDirPath(alias) {
  const safeAlias = normalizeAlias(alias);
  if (!safeAlias) return "";
  return path.dirname(defaultKeyPathForAlias(safeAlias));
}

function aliasMetaPath(alias, name) {
  const dir = aliasDirPath(alias);
  if (!dir) return "";
  return path.join(dir, name);
}

function readTextFile(filePath) {
  if (!filePath || !exists(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function writeTextFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${String(value)}\n`);
}

function removePathIfExists(targetPath) {
  if (!targetPath || !exists(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function loadAliasProfile(alias) {
  const safeAlias = normalizeAlias(alias);
  if (!safeAlias) return null;

  const dir = aliasDirPath(safeAlias);
  if (!exists(dir)) return null;

  const host = readTextFile(aliasMetaPath(safeAlias, "host"));
  const user = readTextFile(aliasMetaPath(safeAlias, "user"));
  const port = readTextFile(aliasMetaPath(safeAlias, "port"));
  const identity = defaultKeyPathForAlias(safeAlias);
  const pub = `${identity}.pub`;

  return {
    alias: safeAlias,
    host,
    user,
    port,
    identity,
    pub,
  };
}

function saveAliasProfile(alias, profile) {
  const safeAlias = normalizeAlias(alias);
  if (!safeAlias) return 1;

  const dir = aliasDirPath(safeAlias);
  ensureDir(dir);

  if (nonEmpty(profile.host)) writeTextFile(aliasMetaPath(safeAlias, "host"), profile.host);
  if (nonEmpty(profile.user)) writeTextFile(aliasMetaPath(safeAlias, "user"), profile.user);
  if (nonEmpty(profile.port)) writeTextFile(aliasMetaPath(safeAlias, "port"), profile.port);

  return 0;
}

function renderManagedBlock(alias, profile) {
  const lines = [
    `# ssh4:${alias}`,
    `Host ${alias}`,
    `  HostName ${profile.host}`,
    `  User ${profile.user}`,
    `  Port ${profile.port}`,
    `  IdentityFile ${profile.identity}`,
    `  IdentitiesOnly yes`,
  ];

  return `${lines.join("\n")}\n`;
}

function updateSshConfig(alias, profile) {
  const filePath = sshConfigPath();
  const markerStart = `# ssh4:${alias}`;
  const markerEnd = `# /ssh4:${alias}`;
  const block = `${renderManagedBlock(alias, profile)}${markerEnd}\n`;
  const current = exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const pattern = new RegExp(
    `${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\n?`,
    "m"
  );
  const next = current.match(pattern)
    ? current.replace(pattern, block)
    : `${current.replace(/\s*$/, "")}${current.trim() ? "\n\n" : ""}${block}`;

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, next);
}

function resolveKeyPath(inputPath) {
  return path.resolve(expandTilde(inputPath ?? defaultKeyPath()));
}

function resolvePubPath(inputPath) {
  const keyPath = resolveKeyPath(inputPath);
  return keyPath.endsWith(".pub") ? keyPath : `${keyPath}.pub`;
}

function help() {
  print("ssh4");
  print("");
  print("Usage:");
  print("  ssh4 client generate <alias> [options]");
  print("  ssh4 client genrate <alias> [options]");
  print("  ssh4 host add <alias> --host <host> [options]");
  print("  ssh4 list");
  print("  ssh4 rm <alias>");
  print("");
  print("Commands:");
  print("  client generate   Generate a new SSH key pair for an alias");
  print("  host add          Save host config if needed, then add the key");
  print("  list              Show saved aliases");
  print("  rm                Remove a saved alias");
  print("");
  print("Options for client generate:");
  print("  --path <path>       Private key path (default: ~/.ssh/ssh4/<alias>/id_ed25519)");
  print("  --comment <text>    Key comment");
  print("  --force             Overwrite existing key files");
  print("");
  print("Options for host add:");
  print("  --host <host>      Real SSH host address (required on first use)");
  print("  --user <user>      Remote SSH user (default: root, but must be passed explicitly)");
  print("  --port <port>      Remote SSH port (default: 22)");
  print("  --identity <path>  Private key path to use");
  print("  --pub <path>       Public key path to use");
  print("  --test             Test passwordless login after installing key");
}

function listHosts() {
  const baseDir = defaultKeyDir();
  if (!exists(baseDir)) {
    print("No saved aliases yet.");
    return 0;
  }

  const aliases = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => normalizeAlias(name))
    .sort();

  if (aliases.length === 0) {
    print("No saved aliases yet.");
    return 0;
  }

  print("Saved aliases:");
  for (const alias of aliases) {
    const item = loadAliasProfile(alias) ?? {};
    print(
      [
        `- ${alias}`,
        item.host ? `host=${item.host}` : null,
        item.user ? `user=${item.user}` : null,
        item.port ? `port=${item.port}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  print("");
  print(`Base dir: ${baseDir}`);
  return 0;
}

function removeHost(alias) {
  const safeAlias = normalizeAlias(alias);
  if (!safeAlias) {
    printErr("Invalid alias.");
    return 1;
  }

  const dir = aliasDirPath(safeAlias);
  const filePath = sshConfigPath();
  const configPattern = new RegExp(
    `${escapeRegExp(`# ssh4:${safeAlias}`)}[\\s\\S]*?${escapeRegExp(`# /ssh4:${safeAlias}`)}\\n?`,
    "m"
  );
  const hasConfigBlock = exists(filePath) && configPattern.test(fs.readFileSync(filePath, "utf8"));

  if (!exists(dir) && !hasConfigBlock) {
    printErr(`Alias not found: ${safeAlias}`);
    return 1;
  }

  removePathIfExists(dir);

  if (exists(filePath)) {
    const current = fs.readFileSync(filePath, "utf8");
    const next = current.replace(configPattern, "").replace(/\n{3,}/g, "\n\n").trimEnd();
    fs.writeFileSync(filePath, next ? `${next}\n` : "");
  }

  print(`Removed alias "${safeAlias}"`);
  return 0;
}

async function generateKey(options) {
  const alias = normalizeAlias(options.alias);
  if (!alias) {
    printErr("Missing alias. Example: ssh4 client generate prod");
    return 1;
  }

  const keyPath = resolveKeyPath(options.path ?? defaultKeyPathForAlias(alias));
  const pubPath = options.pub ? path.resolve(expandTilde(options.pub)) : `${keyPath}.pub`;
  const comment = options.comment ?? `ssh4:${alias}@${os.hostname()}`;
  const force = Boolean(options.force);

  ensureDir(path.dirname(keyPath));

  if (!force && (exists(keyPath) || exists(pubPath))) {
    if (!process.stdin.isTTY) {
      printErr(`Key already exists: ${keyPath}`);
      printErr("Use --force to overwrite or run in an interactive terminal to confirm.");
      return 1;
    }

    const confirmed = await promptYesNo(`Key already exists: ${keyPath}. Overwrite?`);
    if (!confirmed) {
      print("Cancelled.");
      return 1;
    }
  }

  if (force) {
    if (exists(keyPath)) fs.rmSync(keyPath);
    if (exists(pubPath)) fs.rmSync(pubPath);
  }

  const result = run("ssh-keygen", [
    "-t",
    "ed25519",
    "-f",
    keyPath,
    "-N",
    "",
    "-C",
    comment,
  ]);

  if (result.status !== 0) {
    return result.status ?? 1;
  }

  print(`Generated key pair:`);
  print(`  alias:    ${alias}`);
  print(`  private: ${keyPath}`);
  print(`  public:  ${pubPath}`);
  print("");
  print("Next:");
  print(`  ssh4 host add ${shellQuote(alias)} --host <host> --user root --test`);
  return 0;
}

function installKeyOnHost(host, options) {
  const user = options.user ?? os.userInfo().username;
  const port = String(options.port ?? 22);
  const identity = resolveKeyPath(options.identity ?? options.path);
  const pubPath = options.pub ? path.resolve(expandTilde(options.pub)) : `${identity}.pub`;
  const testAfter = Boolean(options.test);

  if (!exists(pubPath)) {
    printErr(`Public key not found: ${pubPath}`);
    printErr("Run `ssh4 client generate` first, or pass --pub.");
    return 1;
  }

  const pubKey = fs.readFileSync(pubPath, "utf8").trim();
  if (!pubKey) {
    printErr(`Public key file is empty: ${pubPath}`);
    return 1;
  }

  const target = `${user}@${host}`;

  if (exists("/usr/bin/ssh-copy-id") || exists("/bin/ssh-copy-id")) {
    const sshCopyId = exists("/usr/bin/ssh-copy-id") ? "/usr/bin/ssh-copy-id" : "/bin/ssh-copy-id";
    const result = run(sshCopyId, ["-i", pubPath, "-p", port, target]);
    if (result.status !== 0) return result.status ?? 1;
  } else {
    const remoteCommand = [
      "umask 077",
      "mkdir -p ~/.ssh",
      "touch ~/.ssh/authorized_keys",
      `grep -qxF ${shellQuote(pubKey)} ~/.ssh/authorized_keys || printf '%s\\n' ${shellQuote(pubKey)} >> ~/.ssh/authorized_keys`,
    ].join("; ");

    const result = run("ssh", ["-p", port, target, remoteCommand]);
    if (result.status !== 0) return result.status ?? 1;
  }

  print(`Installed public key on ${target}`);

  if (testAfter) {
    print("Testing passwordless login...");
    const testResult = run("ssh", [
      "-i",
      identity,
      "-p",
      port,
      "-o",
      "BatchMode=yes",
      "-o",
      "PasswordAuthentication=no",
      target,
      "echo ssh4-ok",
    ]);

    if (testResult.status !== 0) {
      printErr("Login test failed.");
      return testResult.status ?? 1;
    }

    print("Login test passed.");
  }

  return 0;
}

export async function main(argv) {
  const [command, subcommand, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    help();
    return 0;
  }

  if (command === "list") {
    return listHosts();
  }

  if (command === "rm") {
    const alias = subcommand ?? rest[0];
    if (!alias) {
      printErr("Missing alias. Example: ssh4 rm prod");
      return 1;
    }
    return removeHost(alias);
  }

  if (command === "client") {
    const { flags, positionals } = parseArgs(rest);
    const action = subcommand;

    if (action === "--help" || action === "-h" || action === "help") {
      print("Usage: ssh4 client generate [options]");
      return 0;
    }

    if (action === "generate" || action === "genrate") {
      return generateKey({
        alias: positionals[0] ?? flags.alias,
        path: flags.path,
        pub: flags.pub,
        comment: flags.comment,
        force: flags.force,
      });
    }

    printErr(`Unknown client command: ${action}`);
    return 1;
  }

  if (command === "host") {
    const { flags, positionals } = parseArgs(rest);
    const action = subcommand;

    if (action === "--help" || action === "-h" || action === "help") {
      print("Usage: ssh4 host create <alias> --host <host> [options]");
      print("       ssh4 host add <alias> [options]");
      return 0;
    }

    if (action === "add") {
      const alias = positionals[0] ?? flags.alias;
      if (!alias) {
        printErr("Missing alias. Example: ssh4 host add prod --host 1.2.3.4");
        return 1;
      }

      const safeAlias = normalizeAlias(alias);
      if (!safeAlias) {
        printErr("Invalid alias.");
        return 1;
      }

      const profile = loadAliasProfile(safeAlias);
      const host = nonEmpty(profile?.host) || nonEmpty(flags.host);

      if (!host) {
        printErr(`Missing --host for first-time alias "${safeAlias}".`);
        printErr(`Example: ssh4 host add ${safeAlias} --host 1.2.3.4 --user ubuntu`);
        return 1;
      }

      const identity = nonEmpty(flags.identity)
        || nonEmpty(profile?.identity)
        || defaultKeyPathForAlias(safeAlias);
      const pub = nonEmpty(flags.pub)
        || nonEmpty(profile?.pub)
        || `${identity}.pub`;

      if (!exists(pub)) {
        printErr(`Public key not found for alias "${safeAlias}": ${pub}`);
        printErr(`Run: ssh4 client generate ${safeAlias}`);
        return 1;
      }

      const user = nonEmpty(flags.user) || nonEmpty(profile?.user) || "root";

      const mergedProfile = {
        host,
        user,
        port: String(nonEmpty(flags.port) || nonEmpty(profile?.port) || 22),
        identity,
        pub,
      };

      if (!nonEmpty(flags.user) && !nonEmpty(profile?.user)) {
        print(`Using default user: ${user}`);
        print(`Tip: pass --user explicitly to override.`);
      }

      saveAliasProfile(safeAlias, mergedProfile);
      updateSshConfig(safeAlias, mergedProfile);

      return installKeyOnHost(host, {
        user: mergedProfile.user,
        port: mergedProfile.port,
        identity: mergedProfile.identity,
        path: flags.path,
        pub: mergedProfile.pub,
        test: flags.test,
      });
    }

    printErr(`Unknown host command: ${action}`);
    return 1;
  }

  if (command === "--version" || command === "-v") {
    print("0.1.0");
    return 0;
  }

  printErr(`Unknown command: ${command}`);
  printErr("Run `ssh4 --help` for usage.");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve(main(process.argv.slice(2))).then(exit);
}
