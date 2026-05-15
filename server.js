const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const cron    = require('node-cron');
const iconv   = require('iconv-lite');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Campanhas de vacinação ───────────────────────────────────────────────────

let campanhas = [
  // ─── Ativas agora (maio 2026) ─────────────────────────────────────────────
  { id:'influenza-2026',     titulo:'Vacinação contra Influenza (Gripe) 2026',       descricao:'Campanha anual contra gripe. Procure a UBS mais próxima com sua carteira de vacinação.',                                    publicoAlvo:'Idosos 60+, crianças 6m–5a, gestantes, puérperas e profissionais de saúde',     dataInicio:'2026-04-06', dataFim:'2026-06-30', ativa:true,  cor:'#e65100' },
  { id:'dengue-2026',        titulo:'Vacinação contra Dengue — Qdenga 2026',          descricao:'Vacina Qdenga (2 doses) disponível nas UBS para o público-alvo. Intervalo de 3 meses entre as doses.',                        publicoAlvo:'Crianças e adolescentes de 10 a 14 anos',                                        dataInicio:'2026-01-01', dataFim:'2026-12-31', ativa:true,  cor:'#c62828' },
  { id:'covid-2026',         titulo:'Reforço COVID-19 2026',                           descricao:'Dose de reforço bivalente XBB disponível nas UBS e pontos de vacinação. Leve comprovante da última dose.',                    publicoAlvo:'Idosos 60+, imunossuprimidos, gestantes, puérperas e profissionais de saúde',     dataInicio:'2026-03-01', dataFim:'2026-08-31', ativa:true,  cor:'#1565c0' },
  { id:'hpv-2026',           titulo:'Intensificação HPV 2026',                         descricao:'Vacina HPV disponível nas UBS durante todo o ano. 2 doses com intervalo de 6 meses para menores de 15 anos.',                  publicoAlvo:'Meninas e meninos de 9 a 14 anos',                                               dataInicio:'2026-01-01', dataFim:'2026-12-31', ativa:true,  cor:'#7b1fa2' },
  { id:'sarampo-2026',       titulo:'Vacinação contra Sarampo e Poliomielite 2026',    descricao:'Campanha de intensificação. Verifique se você e seus filhos estão com as doses em dia.',                                       publicoAlvo:'Crianças de 6 meses a menores de 5 anos e adultos sem comprovante de vacinação', dataInicio:'2026-05-01', dataFim:'2026-06-30', ativa:true,  cor:'#00695c' },
  { id:'gestante-2026',      titulo:'Vacinação na Gestação 2026',                      descricao:'Gestantes devem receber dTpa, Influenza e Hepatite B durante o pré-natal. Procure sua UBS ou maternidade.',                    publicoAlvo:'Gestantes em qualquer trimestre',                                                 dataInicio:'2026-01-01', dataFim:'2026-12-31', ativa:true,  cor:'#f06292' },
  { id:'febre-amarela-2026', titulo:'Febre Amarela — Vacinação Permanente',             descricao:'Vacina disponível nas UBS durante todo o ano para quem ainda não tomou ou não tem comprovante. Dose única para toda a vida.', publicoAlvo:'Todas as pessoas acima de 9 meses que nunca foram vacinadas',                     dataInicio:'2026-01-01', dataFim:'2026-12-31', ativa:true,  cor:'#f9a825' },
  // ─── Em breve ──────────────────────────────────────────────────────────────
  { id:'multivacinacao-2026',titulo:'Multivacinação 2026',                             descricao:'Campanha anual para atualizar o cartão de vacinas de crianças e adolescentes. Fique atento ao início.',                        publicoAlvo:'Crianças e adolescentes (0–15 anos)',                                            dataInicio:'2026-08-03', dataFim:'2026-09-30', ativa:false, cor:'#2e7d32' },
  { id:'meningite-2026',     titulo:'Intensificação Meningite ACWY 2026',              descricao:'Prevista para o segundo semestre. Vacina contra meningite meningocócica ACWY.',                                                 publicoAlvo:'Adolescentes de 11 a 12 anos',                                                   dataInicio:'2026-09-01', dataFim:'2026-10-31', ativa:false, cor:'#37474f' },
];

// Tenta enriquecer com dados do site do Ministério da Saúde
async function sincronizarCampanhas() {
  try {
    const { load } = require('cheerio');
    const resp = await axios.get(
      'https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/v/vacinacao',
      { timeout: 10000, headers: { 'User-Agent': 'SaudePerto/1.0' } }
    );
    const $ = load(resp.data);
    const encontradas = [];

    $('a, h2, h3, p').each((_, el) => {
      const texto = $(el).text().trim().toLowerCase();
      if (texto.includes('campanha') || texto.includes('vacinação') || texto.includes('vacina')) {
        const nome = $(el).text().trim();
        if (nome.length > 10 && nome.length < 120) encontradas.push(nome);
      }
    });

    console.log(`[Sync] ${encontradas.length} menções encontradas no site do MS`);
    return { ok: true, encontradas: encontradas.length };
  } catch (err) {
    console.warn('[Sync] Falhou:', err.message);
    return { ok: false, erro: err.message };
  }
}

// Roda todo dia às 3h
cron.schedule('0 3 * * *', () => {
  console.log('[Cron] Sincronizando campanhas...');
  sincronizarCampanhas();
});

app.get('/api/campanhas', (req, res) => {
  const { ativa } = req.query;
  const lista = ativa === 'true'
    ? campanhas.filter(c => c.ativa)
    : campanhas;
  res.json({ total: lista.length, campanhas: lista });
});

app.get('/api/campanhas/sync', async (req, res) => {
  const result = await sincronizarCampanhas();
  res.json({ ...result, campanhas: campanhas.filter(c => c.ativa).length });
});

// ─── Medicamentos ─────────────────────────────────────────────────────────────

const DATASUS = 'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos';
const MEDICAMENTOS_BASE = require('./medicamentos.json');

let medicamentos = [...MEDICAMENTOS_BASE];

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

app.get('/api/medicamentos', (req, res) => {
  const termo = req.query.nome || req.query.q || '';
  if (termo.trim().length < 2) return res.json([]);

  const t = norm(termo.trim());
  const resultado = medicamentos
    .filter(m =>
      norm(m.nome).includes(t) ||
      norm(m.nomeGenerico || '').includes(t) ||
      norm(m.classe || '').includes(t)
    )
    .sort((a, b) => {
      if (a.farmaciaPopularGratis && !b.farmaciaPopularGratis) return -1;
      if (!a.farmaciaPopularGratis && b.farmaciaPopularGratis) return 1;
      if (a.disponivelSUS && !b.disponivelSUS) return -1;
      return 0;
    })
    .slice(0, 50);

  res.json(resultado);
});

// ─── Status ───────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => res.json({
  ok: true,
  campanhas: campanhas.filter(c => c.ativa).length,
  medicamentos: medicamentos.length,
  hora: new Date().toISOString(),
}));

app.get('/', (req, res) => res.send('SaúdePerto API — OK'));

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
