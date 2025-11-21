const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const { spawn } = require('child_process'); // Importação crucial para rodar o bot

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Estrutura de Servidores (Simulação de DB)
// Adicionamos 'path' e 'process' para gerenciamento real
let servers = [
    // Servidor de Exemplo Padrão (Você pode remover este bloco se preferir começar vazio)
    {
        id: 101,
        name: 'BlackBot-Master',
        type: 'WhatsApp',
        path: './bots/BlackBot-Main', // ATENÇÃO: Verifique este caminho!
        status: 'offline',
        logs: [`[SISTEMA] Pronto para inicializar. Verifique o caminho: ./bots/BlackBot-Main`],
        process: null // Guarda a referência do processo Node.js
    }
];

// --- FUNÇÕES DE LOGS ---

function addLog(server, message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const logLine = `[${time}] ${isError ? '🚨 ERROR' : ''} ${message}`;
    server.logs.push(logLine);
    io.emit(`log-${server.id}`, logLine); // Envia o log em tempo real para o frontend
}

// --- ROTAS DO PAINEL ---

app.get('/', (req, res) => {
    res.render('dashboard', { servers: servers });
});

app.post('/create', (req, res) => {
    const serverPath = `./bots/${req.body.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const newServer = {
        id: Date.now(),
        name: req.body.name,
        type: req.body.type,
        path: serverPath, // O caminho onde o usuário deve colocar a pasta do bot
        status: 'offline',
        logs: [`[SISTEMA] Novo servidor criado. Crie a pasta ${serverPath} e coloque o código do bot dentro.`],
        process: null
    };
    servers.push(newServer);
    res.redirect('/');
});

app.get('/server/:id', (req, res) => {
    const server = servers.find(s => s.id == req.params.id);
    if (!server) return res.redirect('/');
    res.render('server', { server: server });
});

// --- CONTROLE VIA SOCKET.IO (START/STOP) ---

io.on('connection', (socket) => {
    
    // Iniciar Servidor (Onde a mágica acontece!)
    socket.on('start-server', (serverId) => {
        const server = servers.find(s => s.id == serverId);
        if (!server || server.status === 'online') return;

        addLog(server, `[SISTEMA] Tentando iniciar bot em ${server.path}...`);

        try {
            // 1. Inicia o processo do bot (node index.js)
            const botProcess = spawn('node', ['index.js'], { 
                cwd: server.path, // Define o diretório de trabalho do bot (MUITO IMPORTANTE!)
                shell: true 
            });

            server.process = botProcess;
            server.status = 'online';
            io.emit('status-change', { id: serverId, status: 'online' });
            
            // 2. Captura e envia logs do stdout (saída padrão)
            botProcess.stdout.on('data', (data) => {
                addLog(server, data.toString().trim());
            });

            // 3. Captura e envia logs do stderr (erros)
            botProcess.stderr.on('data', (data) => {
                addLog(server, data.toString().trim(), true);
            });
            
            // 4. Lida com o processo sendo encerrado
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

    // Parar Servidor
    socket.on('stop-server', (serverId) => {
        const server = servers.find(s => s.id == serverId);
        if (!server || server.status !== 'online' || !server.process) return;

        addLog(server, `[SISTEMA] Tentando encerrar processo...`);
        server.process.kill('SIGINT'); // Envia sinal para encerrar
    });
});

http.listen(3000, () => {
    console.log('Painel de Hospedagem rodando em http://localhost:3000');
});
