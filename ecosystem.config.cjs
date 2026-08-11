module.exports = {
    apps: [
        {
            name: 'qoqbot',
            cwd: '/opt/servers/qoqbot/app',
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
