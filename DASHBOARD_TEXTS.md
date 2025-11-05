# 📝 Textos para Dashboard Vercel

## PARTE 1: O que é o sistema (Visão Geral)

### Versão Longa

**LogLineOS** é uma plataforma backend universal, ledger-only e multitenant onde toda a lógica de negócio vive como **spans versionados** em um ledger PostgreSQL imutável. Ao invés de código tradicional, o sistema executa **kernels** (funções versionadas) armazenados no próprio banco de dados, garantindo auditoria completa, rastreabilidade e governança computável.

Cada operação — desde execução de funções até gerenciamento de memória, prompts e políticas — é registrada como um **span assinado** (Ed25519 + BLAKE3) em uma tabela append-only. Isso significa que tudo é imutável, auditável e rastreável. O sistema é **multitenant por design**, com isolamento garantido por Row-Level Security (RLS) do PostgreSQL.

O LogLineOS oferece serviços prontos para produção: **Memory System** (armazenamento e busca semântica), **Prompt System** (prompts versionados e componíveis), **Policy Engine** (políticas computáveis), e um **CLI as a Service** que simplifica operações comuns. Tudo funciona através de uma API REST stateless, perfeita para frontends modernos (Next.js, React, mobile apps).

### Versão Curta (para cards/hero)

**LogLineOS** é uma plataforma backend ledger-only onde toda a lógica vive como spans versionados em um banco imutável. Cada operação é auditável, rastreável e multitenant por design. Execute funções, gerencie memória, prompts e políticas — tudo através de APIs REST simples e seguras.

### Versão Ultra-Curta (para badges/tags)

Backend ledger-only, multitenant, com spans versionados e auditoria completa. APIs REST, PostgreSQL, serverless-first.

---

## PARTE 2: Foco no Auth (Sistema de Autenticação)

### Versão Longa

O sistema de autenticação do LogLineOS é **ledger-native** e **sem senhas**. Tudo funciona via **API Keys** (`Authorization: ApiKey tok_live_...`) que são emitidas, rotacionadas e revogadas através de spans no próprio ledger, garantindo auditoria completa de todo o ciclo de vida.

Cada token está vinculado a um **Wallet** (cofre seguro) que armazena chaves criptográficas (Ed25519) e credenciais de provedores (Anthropic, OpenAI, etc.) no AWS Secrets Manager. O Wallet nunca expõe segredos — apenas oferece operações seguras como `sign.span` (assinar spans), `sign.http` (assinar requisições) e `provider.invoke` (invocar LLMs sem expor API keys).

O **Lambda Authorizer** valida tokens em tempo real no DynamoDB, verifica escopos granulares (ex: `memory.*`, `prompt.fetch`, `kernel:prompt_fetch:invoke`) e injeta `wallet_id`, `tenant_id` e `scopes` no contexto da requisição. Toda mutação relevante no ledger **deve ser assinada** pelo Wallet antes de ser aceita — o Stage-0 Loader recusa spans sem assinatura válida.

O sistema suporta **rotação de tokens**, **revogação imediata**, **anti-replay** via nonces, e está preparado para evoluir para JWT curtos e autenticação Ed25519 direta (modo híbrido) no futuro. Tudo é auditável: cada emissão, uso, rotação e revogação gera spans no ledger.

### Versão Curta (para cards/hero)

**Autenticação ledger-native sem senhas**. API Keys vinculadas a Wallets seguros que armazenam chaves criptográficas e credenciais. Cada token tem escopos granulares, é validado em tempo real, e toda mutação é assinada (Ed25519 + BLAKE3) antes de entrar no ledger. Rotação, revogação e auditoria completas — tudo como spans versionados.

### Versão Ultra-Curta (para badges/tags)

Auth ledger-native, API Keys, Wallet seguro, assinaturas Ed25519, escopos granulares, sem senhas.

---

## 🎨 Sugestões de Uso no Dashboard

### Hero Section
- **Título**: "LogLineOS — Backend Ledger-Only"
- **Subtítulo**: Versão Curta (Sistema Geral)
- **CTA**: "Começar" / "Documentação"

### Cards de Features
- **Card 1**: "Ledger-Only" → Versão Ultra-Curta (Sistema Geral)
- **Card 2**: "Multitenant" → Versão Ultra-Curta (Sistema Geral)
- **Card 3**: "Auth Sem Senhas" → Versão Ultra-Curta (Auth)

### Seção Auth
- **Título**: "Autenticação Ledger-Native"
- **Descrição**: Versão Longa (Auth)
- **Features**: Lista com ícones (API Keys, Wallet, Escopos, Assinaturas)

### Footer/About
- Versão Longa (Sistema Geral) ou Versão Curta

---

## 📋 Textos Estruturados para Copy/Paste

### Sistema Geral (HTML/Markdown ready)

```markdown
**LogLineOS** é uma plataforma backend universal, ledger-only e multitenant onde toda a lógica de negócio vive como **spans versionados** em um ledger PostgreSQL imutável. Cada operação é registrada como um **span assinado** (Ed25519 + BLAKE3), garantindo auditoria completa e rastreabilidade. O sistema oferece serviços prontos: Memory System, Prompt System, Policy Engine e CLI as a Service — tudo através de APIs REST stateless.
```

### Auth (HTML/Markdown ready)

```markdown
**Autenticação ledger-native sem senhas**. O LogLineOS funciona via **API Keys** vinculadas a **Wallets** seguros que armazenam chaves criptográficas e credenciais no AWS Secrets Manager. Cada token tem escopos granulares, é validado em tempo real, e toda mutação é **assinada** (Ed25519 + BLAKE3) antes de entrar no ledger. Rotação, revogação e auditoria completas — tudo como spans versionados.
```

---

**Versão:** 1.0  
**Data:** 2025-01-XX  
**Uso:** Dashboard Vercel Multitenancy Template

