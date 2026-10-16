#!/usr/bin/env node
import crypto from 'node:crypto';
import readline from 'node:readline';
import { pool } from '../src/db/index.ts';
import { ensureDatabaseSchema } from '../src/db/bootstrap.ts';
import { hashPassword } from '../src/server/localAuth.ts';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: {
    username?: string;
    email?: string;
    password?: string;
    reset?: boolean;
    help?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--username' || arg === '-u') {
      options.username = args[++i];
    } else if (arg.startsWith('--username=')) {
      options.username = arg.split('=')[1];
    } else if (arg === '--email' || arg === '-e') {
      options.email = args[++i];
    } else if (arg.startsWith('--email=')) {
      options.email = arg.split('=')[1];
    } else if (arg === '--password' || arg === '-p') {
      options.password = args[++i];
    } else if (arg.startsWith('--password=')) {
      options.password = arg.split('=')[1];
    } else if (arg === '--reset' || arg === '-f' || arg === '--force') {
      options.reset = true;
    }
  }

  return options;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function promptHidden(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    // If not a TTY (piped), fallback to regular prompt
    if (!process.stdin.isTTY) {
      return resolve(prompt(rl, question));
    }

    process.stdout.write(question);
    const stdin = process.stdin;
    const oldRawMode = stdin.isRaw;
    let input = '';

    const onData = (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.removeListener('data', onData);
        if (stdin.setRawMode) stdin.setRawMode(oldRawMode || false);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '\b' || char === '\x7f') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += char;
      }
    };

    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Использование:
  docker compose exec infralab npm run create-admin
  или с параметрами:
  docker compose exec infralab npm run create-admin -- --username <логин> --email <email> --password <пароль>

Параметры:
  -u, --username  Логин администратора (минимум 3 символа)
  -e, --email     Email администратора
  -p, --password  Пароль (минимум 6 символов)
  -f, --reset     Сбросить пароль и 2FA, если пользователь уже существует
  -h, --help      Показать эту справку
`);
    process.exit(0);
  }

  console.log('======================================================================');
  console.log(' InfraLab · Создание / сброс учётной записи администратора (CLI)     ');
  console.log('======================================================================\n');

  let username = options.username;
  let email = options.email;
  let password = options.password;

  const isInteractive = process.stdin.isTTY || (!username || !email || !password);

  if (isInteractive && (!username || !email || !password)) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      if (!username) {
        const inputUser = await prompt(rl, 'Логин администратора [admin]: ');
        username = inputUser || 'admin';
      }

      if (!email) {
        const defaultEmail = `${username}@infralab.local`;
        const inputEmail = await prompt(rl, `Email администратора [${defaultEmail}]: `);
        email = inputEmail || defaultEmail;
      }

      while (!password) {
        const pass1 = await promptHidden(rl, 'Введите пароль администратора (мин. 6 символов): ');
        if (!pass1 || pass1.length < 6) {
          console.log('❌ Пароль должен содержать не менее 6 символов. Попробуйте снова.\n');
          continue;
        }

        const pass2 = await promptHidden(rl, 'Повторите пароль: ');
        if (pass1 !== pass2) {
          console.log('❌ Пароли не совпадают. Попробуйте снова.\n');
          continue;
        }

        password = pass1;
      }
    } finally {
      rl.close();
    }
  }

  username = String(username || '').trim();
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');

  // Validation
  if (!username || username.length < 3 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    console.error('❌ Ошибка: Логин должен быть длиной от 3 символов (латиница, цифры, _, ., -).');
    process.exit(1);
  }
  if (!email || !email.includes('@')) {
    console.error('❌ Ошибка: Укажите корректный email адрес.');
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error('❌ Ошибка: Пароль должен содержать минимум 6 символов.');
    process.exit(1);
  }

  try {
    console.log(' Подключение к базе данных PostgreSQL...');
    await ensureDatabaseSchema();

    // Check if user exists by username or email
    const existing = await pool.query(
      `SELECT uid, username, email FROM users
       WHERE lower(username) = lower($1) OR lower(email) = lower($2)
       LIMIT 1`,
      [username, email]
    );

    const passwordHash = hashPassword(password);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      await pool.query(
        `UPDATE users
         SET username = $1,
             email = $2,
             password_hash = $3,
             auth_provider = 'local',
             totp_enabled = 0,
             totp_secret_encrypted = '',
             totp_pending_secret_encrypted = '',
             recovery_codes_hashes = '[]'
         WHERE uid = $4`,
        [username, email, passwordHash, user.uid]
      );

      console.log('\n======================================================================');
      console.log('✅ Пароль администратора успешно обновлён!');
      console.log('----------------------------------------------------------------------');
      console.log(` Логин:        ${username}`);
      console.log(` Email:        ${email}`);
      console.log(' Пароль:       [успешно установлен]');
      console.log(' 2FA:          Сброшена/отключена (можно включить в Settings)');
      console.log(' Вход:         http://<адрес-сервера>:3000');
      console.log('======================================================================\n');
    } else {
      const uid = `infralab-admin-${crypto.randomBytes(4).toString('hex')}`;
      await pool.query(
        `INSERT INTO users (uid, email, username, password_hash, auth_provider, totp_enabled)
         VALUES ($1, $2, $3, $4, 'local', 0)`,
        [uid, email, username, passwordHash]
      );

      console.log('\n======================================================================');
      console.log('✅ Администратор InfraLab успешно создан!');
      console.log('----------------------------------------------------------------------');
      console.log(` Логин:        ${username}`);
      console.log(` Email:        ${email}`);
      console.log(' Пароль:       [успешно установлен]');
      console.log(' 2FA:          Отключена (можно включить в Settings)');
      console.log(' Вход:         http://<адрес-сервера>:3000');
      console.log('======================================================================\n');
    }

    await pool.end();
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Ошибка при создании администратора:', err?.message || err);
    try {
      await pool.end();
    } catch {}
    process.exit(1);
  }
}

main();
