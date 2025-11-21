// index.js (Painel Redwave - Versão FINAL E FUNCIONAL)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// --- CONFIGURAÇÃO DOS BOTS DO GITHUB ---
const botTemplates = [
    { name: 'BlackBot-WA', url: 'https://github.com/bronxys/Black.git', type: 'WhatsApp' },
    { name: 'NazunaBot-WA', url: 'https://github.com/bronxys/Nazuna.git', type: 'WhatsApp' }
];

// --- SIMULAÇÃO DE BANCO DE DADOS (em memória) ---
let servers = [];

// --- FUNÇÕES DE LOGS E EMISSÃO DE EVENTOS ---

function addLog(server, message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const logLine = `[${time}] ${isError ? '🚨 ERROR' : ''} ${message}`;
    server.logs.push(logLine);
    io.emit(`log-${server.id}`, logLine);
}

// --- ROTAS PRINCIPAIS E DO MENU LATERAL (Todas funcionais) ---

app.get('/', (req, res) => {
    res.render('dashboard', { servers: servers, botTemplates: botTemplates });
});

app.get('/servidores', (req, res) => {
    res.redirect('/');
});

app.get('/loja', (req, res) => {
    res.render('generic_page', { title: 'Loja de Recursos', content: 'Em breve: Upgrade de hardware e créditos. Sistema em manutenção.' });
});

app.get('/perfil', (req, res) => {
    res.render('generic_page', { title: 'Configurações de Perfil', content: 'Em breve: Gerencie sua conta e chaves API.' });
});

app.get('/logout', (req, res) => {
    res.render('generic_page', { title: 'Sessão Encerrada', content: 'Você foi desconectado do Painel Redwave.' });
});

app.post('/create', (req, res) => {
    const templateName = req.body.template;
    const serverName = req.body.name.trim();
    
    if (!serverName) return res.send('O nome do servidor não pode ser vazio.');
    const template = botTemplates.find(t => t.name === templateName);
    if (!template) return res.send('Erro: Template de bot inválido.');
    
    const folderName = serverName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30) + '-' + Date.now();
    const serverPath = path.join('./bots', folderName);
    
    if (!fs.existsSync('./bots')) { fs.mkdirSync('./bots'); }

    const newServer = { id: Date.now(), name: serverName, type: template.type, path: serverPath, status: 'cloning', logs: [`[SISTEMA] Iniciando clone de ${template.name}`], process: null };
    servers.push(newServer);
    
    const cloneCommand = `git clone ${template.url} ${serverPath}`;
    addLog(newServer, `[GIT] Executando: ${cloneCommand}`);

    exec(cloneCommand, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
            addLog(newServer, `[GIT ERRO] Falha ao clonar. ${error.message}`, true);
            newServer.status = 'error';
            io.emit('status-change', { id: newServer.id, status: 'error' });
            return;
        }
        addLog(newServer, `[GIT SUCESSO] Repositório clonado.`, false);
        addLog(newServer, `[AVISO CRÍTICO] **PASSO OBRIGATÓRIO:** Entre na pasta e execute 'npm install'.`, true);
        newServer.status = 'offline';
        io.emit('status-change', { id: newServer.id, status: 'offline' });
    });

    res.redirect('/');
});

app.get('/server/:id', (req, res) => {
    const server = servers.find(s => s.id == req.params.id);
    if (!server) return res.redirect('/');
    res.render('server', { server: server });
});

// --- CONTROLE VIA SOCKET.IO (COMANDOS) ---

io.on('connection', (socket) => {
    
    socket.on('send-command', ({ serverId, command }) => {
        const server = servers.find(s => s.id == serverId);
        // Só permite comandos se o status for 'online' e o processo existir
        if (!server || server.status !== 'online' || !server.process) {
            return socket.emit(`log-${serverId}`, '[ERRO] Servidor offline ou processo indisponível.');
        }

        const cleanCommand = command.trim();
        if (cleanCommand.length > 0) {
            server.process.stdin.write(cleanCommand + '\n'); 
            addLog(server, `[COMANDO: ${cleanCommand}]`, false);
        }
    });

    socket.on('start-server', (serverId) => {
        const server = servers.find(s => s.id == serverId);
        if (!server || server.status === 'online' || server.status === 'cloning' || server.status === 'error') return;

        addLog(server, `[SISTEMA] Tentando iniciar bot...`);
        try {
            const botProcess = spawn('node', ['index.js'], { cwd: server.path, shell: true });
            server.process = botProcess;
            server.status = 'online';
            io.emit('status-change', { id: serverId, status: 'online' });
            
            botProcess.stdout.on('data', (data) => addLog(server, data.toString().trim()));
            botProcess.stderr.on('data', (data) => addLog(server, data.toString().trim(), true));
            
            botProcess.on('exit', (code) => {
                server.status = 'offline';
                server.process = null;
                addLog(server, `[SISTEMA] Bot encerrado com código: ${code || '0'}`);
                io.emit('status-change', { id: serverId, status: 'offline' });
            });

        } catch (error) {
            addLog(server, `[ERRO CRÍTICO] Falha ao iniciar: ${error.message}`, true);
        }
    });

    socket.on('stop-server', (serverId) => {
        const server = servers.find(s => s.id == serverId);
        if (!server || server.status !== 'online' || !server.process) return;
        addLog(server, `[SISTEMA] Tentando encerrar processo...`);
        server.process.kill('SIGINT');
    });
});

http.listen(3000, () => {
    console.log('Painel de Hospedagem Redwave rodando em http://localhost:3000');
});
