// index.js (Painel com Git Clone)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const { spawn, exec } = require('child_process'); // 'exec' é essencial para o 'git clone'
const fs = require('fs'); // Para garantir que a pasta 'bots' exista

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

// --- ROTAS DO PAINEL ---

app.get('/', (req, res) => {
    res.render('dashboard', { servers: servers, botTemplates: botTemplates });
});

// Rota de Criação de Servidor (Agora com Git Clone)
app.post('/create', (req, res) => {
    const templateName = req.body.template;
    const serverName = req.body.name.trim();
    
    if (!serverName) return res.send('O nome do servidor não pode ser vazio.');

    const template = botTemplates.find(t => t.name === templateName);

    if (!template) {
        return res.send('Erro: Template de bot inválido.');
    }
    
    // Cria um nome de pasta seguro
    const folderName = serverName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30) + '-' + Date.now();
    const serverPath = `./bots/${folderName}`;
    
    // Verifica se a pasta bots existe, se não, cria
    if (!fs.existsSync('./bots')) {
        fs.mkdirSync('./bots');
    }

    // Estrutura do novo servidor
    const newServer = {
        id: Date.now(),
        name: serverName,
        type: template.type,
        path: serverPath,
        status: 'cloning', // Novo status
        logs: [`[SISTEMA] Iniciando clone de ${template.name} de ${template.url}`],
        process: null
    };
    servers.push(newServer);
    
    // --- EXECUÇÃO DO GIT CLONE ---
    const cloneCommand = `git clone ${template.url} ${serverPath}`;
    addLog(newServer, `[GIT] Executando: ${cloneCommand}`);

    exec(cloneCommand, { timeout: 120000 }, (error, stdout, stderr) => { // Timeout de 120s
        if (error) {
            addLog(newServer, `[GIT ERRO] Falha ao clonar. ${error.message}`, true);
            addLog(newServer, `[GIT ERRO] Certifique-se de que o GIT está instalado.`, true);
            newServer.status = 'error';
            io.emit('status-change', { id: newServer.id, status: 'error' });
            return;
        }

        addLog(newServer, `[GIT SUCESSO] Repositório clonado para ${serverPath}.`);
        addLog(newServer, `[SISTEMA] Bot pronto para rodar. Execute 'npm install' manualmente na pasta do bot antes de INICIAR.`);
        
        newServer.status = 'offline';
        io.emit('status-change', { id: newServer.id, status: 'offline' });
    });

    // Redireciona imediatamente para mostrar o servidor em status 'cloning'
    res.redirect('/');
});

app.get('/server/:id', (req, res) => {
    const server = servers.find(s => s.id == req.params.id);
    if (!server) return res.redirect('/');
    res.render('server', { server: server });
});

// --- CONTROLE VIA SOCKET.IO (START/STOP) ---

io.on('connection', (socket) => {
    
    socket.on('start-server', (serverId) => {
        const server = servers.find(s => s.id == serverId);
        if (!server || server.status === 'online') return;

        addLog(server, `[SISTEMA] Tentando iniciar bot em ${server.path}...`);

        try {
            // INICIA O BOT: 'node index.js' DENTRO DA PASTA CLONADA
            const botProcess = spawn('node', ['index.js'], { 
                cwd: server.path, 
                shell: true 
            });

            server.process = botProcess;
            server.status = 'online';
            io.emit('status-change', { id: serverId, status: 'online' });
            
            botProcess.stdout.on('data', (data) => {
                addLog(server, data.toString().trim());
            });

            botProcess.stderr.on('data', (data) => {
                addLog(server, data.toString().trim(), true);
            });
            
            botProcess.on('exit', (code) => {
                server.status = 'offline';
                server.process = null;
                addLog(server, `[SISTEMA] Bot encerrado com código: ${code || '0'}`);
                io.emit('status-change', { id: serverId, status: 'offline' });
            });

        } catch (error) {
            addLog(server, `[ERRO CRÍTICO] Falha ao iniciar spawn: ${error.message}`, true);
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
    console.log('Painel de Hospedagem rodando em http://localhost:3000');
});
