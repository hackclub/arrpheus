// script: open .env, read the file. for each line, run `heroku config:set` with the key and value

const fs = require('fs');
const exec = require('child_process').exec;

fs.readFile('.env', 'utf8', (err, data) => {
    if (err) {
        console.error(err);
        return;
    }
    
    const lines = data.split('\n');
    
    lines.forEach(line => {
        const [key, value] = line.trim().split('=');
        if (key && value) {
            console.log(`Setting ${key}=${value}`);
        exec(`heroku config:set --app arrpheus ${key}=${value}`, (err, stdout, stderr) => {
            if (err) {
            console.error(err);
            return;
            }
            console.log(stdout);
        });
        }
    });
});