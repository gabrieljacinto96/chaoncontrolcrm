# CRM Imobiliario para Equipa de Consultores

Aplicacao web para gerir clientes de uma equipa de consultoria imobiliaria.

## Funcionalidades

- Login de utilizadores
- Login personalizado por comercial (conta individual)
- Registo de clientes imobiliarios
- Tipologia de cliente (vendedor, comprador, ou ambos)
- Campos de cliente:
  - nome
  - cliente vendedor
  - cliente comprador
  - telemovel
  - morada
  - imovel
  - observacoes
- Edicao e eliminacao de clientes
- Pesquisa rapida por nome, telemovel, morada ou imovel
- Filtro por tipo de cliente (vendedor, comprador, ambos)
- Exportacao CSV dos clientes (com filtros aplicados)
- Historico de contactos por cliente (canal, resumo, proximo passo, data)
- Painel com resumo de clientes
- Interface otimizada para smartphone (Android)
- Instalacao como PWA (app no ecra inicial e no computador)
- Cache basica de assets para abertura mais rapida

## Stack

- Node.js + Express
- SQLite
- HTML, CSS e JavaScript vanilla

## Colocar Online Sem o Teu PC (permanente)

Este repositorio ja inclui ficheiros para deploy em cloud com base de dados SQLite persistente:
- [Dockerfile](Dockerfile)
- [.dockerignore](.dockerignore)
- [render.yaml](render.yaml)

Passos rapidos (Render):

1. Criar conta em Render e ligar o teu repositorio GitHub.
2. No painel Render, escolher `New +` -> `Blueprint`.
3. Selecionar o repositorio deste projeto.
4. Confirmar o plano e criar o servico.
5. Esperar o primeiro deploy terminar e abrir o URL publico gerado.

Notas importantes:
- O ficheiro [render.yaml](render.yaml) ja cria disco persistente em `/app/data`, por isso a base `sistema.db` nao se perde entre reinicios.
- O endpoint de health check ja esta pronto em `/api/health`.
- Depois do primeiro login, muda a password do `admin`.

## Como executar (Windows)

1. Instalar dependencias:

```bash
npm install
```

2. Iniciar em modo desenvolvimento:

```bash
npm run dev
```

3. Abrir no navegador:

http://localhost:3000

## Usar no Android (PWA)

1. No PC, iniciar o sistema com `npm run dev`.
2. No Android, abrir o URL de rede local no Chrome (exemplo: `http://192.168.1.50:3000`).
3. No topo da app, tocar em `Instalar` quando o aviso de instalacao aparecer.
4. Confirmar a instalacao para criar o atalho no ecra inicial.

Notas:
- A instalacao PWA depende do navegador (recomendado: Chrome no Android).
- As chamadas da API continuam a precisar de ligacao ao servidor para dados em tempo real.

## Instalar no computador (PWA)

1. Abrir `http://localhost:3000` no Chrome ou Edge.
2. No painel de instalacao da app, clicar em `Instalar`.
3. Se o botao nao estiver ativo, usar o menu do navegador (`Instalar app`) ou o icone de instalacao na barra de endereco.

## Se nao abre no telemovel

1. Confirmar que o servidor esta ligado no PC e mostra `Acesso em rede local` no terminal.
2. No telemovel, abrir exatamente esse URL (exemplo: `http://192.168.1.50:3000`) e nao `localhost`.
3. Garantir que PC e telemovel estao na mesma rede Wi-Fi.
4. No Windows, permitir a app na firewall para a porta `3000` (rede privada).

## Trabalhar offline no Android

Se o servidor estiver desligado, podes tocar em `Usar sem servidor` no ecrã de login e começar em modo local.

Depois de entrares com internet pelo menos uma vez, a app guarda sessao e dados locais no telemovel.

Quando ficares sem rede:
- O sistema entra em `Modo offline ativo`.
- Podes criar, editar e eliminar clientes.
- Podes registar contactos dos clientes.
- As alteracoes ficam em fila local como `acoes pendentes`.

Quando a internet voltar:
- A app tenta sincronizar automaticamente as acoes pendentes.
- Tambem podes tocar em `Sincronizar pendentes` no painel offline.
- Se voltares a abrir a app ou entrares novamente em rede, ela tenta detetar o servidor e sincronizar sem precisares de fazer nada.
- Se começaste em modo local, basta entrares com a tua conta real quando o servidor voltar para enviar a fila local para a base central.

Limites atuais do modo offline:
- Exportacao CSV requer ligacao ao servidor.
- Estatisticas avancadas (dados de server) podem mostrar a ultima versao em cache ate voltar a rede.

## Utilizacao em varios computadores (rede local)

Para que os registos fiquem sincronizados entre todos os comerciais, devem usar uma unica instancia do servidor e da base de dados.

1. Escolher um PC para ficar como servidor (onde estao os dados em `data/sistema.db`).
2. Nesse PC, iniciar o sistema:

```bash
npm run dev
```

3. No terminal, copiar um URL de "Acesso em rede local" (ex.: `http://192.168.1.50:3000`).
4. Nos outros PCs, abrir esse URL no navegador.

Notas importantes:
- Nao executar `npm run dev` em cada PC da equipa, senao cada maquina cria a sua propria base local.
- Garantir que a firewall do Windows permite ligacoes na porta `3000` no PC servidor.
- Todos os comerciais devem entrar pelo mesmo URL de rede para partilharem os mesmos registos.

## Modo hibrido (offline + sincronizacao quando houver ligacao)

Este modo permite cada comercial trabalhar no seu proprio PC (offline) e sincronizar quando necessario com um no central.

### Como funciona

- Cada PC tem a sua base local (`data/sistema.db`) e continua a funcionar sem internet/rede.
- Quando clicar em `Sincronizar Agora`, o no local faz:
  - `push` das alteracoes locais para o no central
  - `pull` das alteracoes mais recentes do no central
- A regra de conflito e `ultima atualizacao vence` (campo `updated_at`).

### Variaveis de ambiente

- `SYNC_SHARED_KEY`: chave partilhada entre todos os nos (obrigatoria para sync).
- `SYNC_UPSTREAM_URL`: URL do no central (obrigatoria apenas nos nos locais).
- `SYNC_NODE_ID`: identificador do no (opcional; por omissao usa o hostname).

### Exemplo de configuracao

No central (nao precisa de `SYNC_UPSTREAM_URL`):

```powershell
$env:SYNC_SHARED_KEY = "troca-esta-chave"
npm run dev
```

No local de um comercial:

```powershell
$env:SYNC_SHARED_KEY = "troca-esta-chave"
$env:SYNC_UPSTREAM_URL = "http://192.168.1.50:3000"
$env:SYNC_NODE_ID = "portatil-ana"
npm run dev
```

### Interface

- Existe um painel `Sincronizacao Hibrida` com:
  - estado da ultima sincronizacao
  - total de alteracoes locais pendentes
  - botao `Sincronizar Agora`

Notas importantes:
- A mesma `SYNC_SHARED_KEY` deve ser usada em todos os nos.
- O no central deve estar acessivel na rede quando for feita a sincronizacao.
- Eliminacoes sao logicas (soft delete) para evitar perdas em sincronizacao.

## Credenciais iniciais

- Utilizador: admin
- Palavra-passe: admin123

## Contas de comercial

- O admin pode criar contas individuais de comercial na secao "Contas de Comerciais".
- Cada comercial entra com o seu proprio utilizador e palavra-passe.
- Quando um comercial autenticado regista ou edita um cliente, o campo de comercial fica associado automaticamente ao utilizador autenticado.

## Estrutura

- src/server.js: API e servidor web
- src/db.js: criacao e acesso a base SQLite
- public/: frontend
- data/sistema.db: base de dados (gerada automaticamente)
