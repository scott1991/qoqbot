module.exports = {
    apps: [
        {
            name: 'qoqbot',
            cwd: __dirname,
            script: 'index.js',
            interpreter: process.execPath,
            autorestart: true,
            time: true,
            env_production: {
                NODE_ENV: 'production'
            }
        }
    ]
};
