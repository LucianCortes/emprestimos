// ============================================================
// SERVICE WORKER — o app abre SEM INTERNET
// ============================================================
// Sem este arquivo, o icone na tela do celular e so um atalho: sem sinal, o
// navegador tenta buscar a pagina no servidor, falha, e o dono fica sem o app.
// Aqui a propria pagina fica guardada no aparelho.
//
// Estrategia: CACHE PRIMEIRO, ATUALIZA EM SEGUNDO PLANO.
//   - responde na hora com a copia guardada (abre instantaneo e offline);
//   - em paralelo busca a versao nova na rede e regrava a copia;
//   - a versao nova aparece na PROXIMA abertura (o app avisa por toast).
//
// REGRA INEGOCIAVEL: NADA do Supabase passa por aqui. Nem a API (dados), nem o
// storage (fotos). Se uma resposta de dados caisse no cache, o app poderia
// mostrar saldo velho como se fosse o de agora — isso e pior do que nao ter
// cache nenhum. Essas chamadas sao deixadas passar direto para a rede.
// ============================================================
'use strict';

// Troque a data ao publicar uma versao nova: e isso que apaga o cache velho.
var VERSAO = '2026-09-20';
var CACHE = 'emprestimos-' + VERSAO;

// O minimo para o app abrir sozinho: a propria pagina, o manifesto e a
// biblioteca da nuvem (o app checa a sessao com ela assim que abre).
// Caminhos RELATIVOS porque o app mora numa subpasta do GitHub Pages.
var ESSENCIAIS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Um endereco do Supabase (dados ou fotos) nunca pode ser guardado nem servido
// do cache. Checagem por dominio, que e o que o app de fato usa.
function ehSupabase(url) {
  try {
    var h = new URL(url).hostname;
    return h === 'supabase.co' || h.indexOf('.supabase.co') >= 0 ||
           h === 'supabase.in' || h.indexOf('.supabase.in') >= 0;
  } catch (e) {
    // Na duvida sobre o endereco, trata como Supabase: deixa passar direto.
    return true;
  }
}

// INSTALL — baixa o essencial. addAll falha inteiro se UM arquivo falhar, e o
// CDN pode estar fora do ar na hora: por isso cada item vai em separado e a
// falha de um nao impede o resto (a pagina em si e o que mais importa).
self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ESSENCIAIS.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    })
  );
  // Sem skipWaiting de proposito: trocar o worker por baixo de uma pagina ja
  // aberta e receita de tela pela metade. A versao nova entra quando o dono
  // fechar e abrir o app — e o app avisa isso por toast.
});

// ACTIVATE — apaga os caches das versoes anteriores e assume as abas abertas.
self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        if (n !== CACHE && n.indexOf('emprestimos-') === 0) return caches.delete(n);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// FETCH — cache primeiro, rede em segundo plano.
self.addEventListener('fetch', function (ev) {
  var req = ev.request;

  // So GET: envio de dado (POST/PATCH/DELETE) nunca entra em cache.
  if (req.method !== 'GET') return;

  // Supabase passa direto, sem tocar no cache. NAO chamamos respondWith:
  // o navegador cuida da chamada como se o service worker nem existisse.
  if (ehSupabase(req.url)) return;

  // Endereco que nao e http(s) (extensao, blob, data) tambem passa direto.
  if (req.url.indexOf('http') !== 0) return;

  // O proprio sw.js nunca entra no cache: e ele que carrega as versoes novas,
  // e uma copia velha dele poderia congelar o app numa versao antiga.
  if (req.url.indexOf('/sw.js') >= 0) return;

  ev.respondWith(
    caches.match(req).then(function (guardado) {
      var daRede = fetch(req).then(function (res) {
        // Guarda a copia nova para a proxima abertura. 'opaque' e resposta de
        // outro dominio sem CORS (fonte do Google, por exemplo): serve para
        // desenhar, entao vale guardar.
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copia).catch(function () {});
          }).catch(function () {});
        }
        return res;
      }).catch(function () {
        // Sem internet: se havia copia, ela ja foi devolvida abaixo.
        return guardado || Response.error();
      });

      // Tem copia? responde na hora com ela (a rede segue em segundo plano).
      return guardado || daRede;
    })
  );
});
