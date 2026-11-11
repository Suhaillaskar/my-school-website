const { createInterface } = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { createUser } = require('../lib/database');
const { isValidPassword } = require('../lib/passwords');

async function readPassword(prompt) {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
        const lineReader = createInterface({ input: stdin, output: stdout });
        try {
            return await lineReader.question(prompt);
        } finally {
            lineReader.close();
        }
    }

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    return new Promise((resolve, reject) => {
        let password = '';
        const finish = (error) => {
            stdin.removeListener('data', onInput);
            stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\n');
            if (error) reject(error);
            else resolve(password);
        };
        const onInput = (input) => {
            for (const character of input.toString('utf8')) {
                if (character === '\u0003') return finish(new Error('Admin setup cancelled.'));
                if (character === '\r' || character === '\n') return finish();
                if (character === '\u007f' || character === '\b') {
                    password = Array.from(password).slice(0, -1).join('');
                } else if (character >= ' ') {
                    password += character;
                }
            }
        };
        stdin.on('data', onInput);
    });
}

async function main() {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
        const email = (await prompt.question('Admin email: ')).trim().toLowerCase();
        prompt.close();
        const password = await readPassword('Admin password (at least 12 characters): ');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error('Enter a valid email address.');
        }
        if (!isValidPassword(password)) {
            throw new Error('The password must be between 12 and 128 characters.');
        }
        await createUser(email, 'admin', password);
        console.log('Admin account created. Keep the password private.');
    } finally {
        prompt.close();
    }
}

main().catch((error) => {
    console.error(`Could not create admin: ${error.message}`);
    process.exitCode = 1;
});
