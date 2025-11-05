# 📧 Email Service Specification

## Visão Geral

Serviço de email **opcional** para:
- ✅ Verificação de email (confirma que o email é válido)
- ✅ Recovery de conta (reset de chave)
- ✅ Notificações de segurança (token emitido, wallet criado)
- ✅ Convites de tenant

**Importante:** O onboarding funciona **sem email**, mas email adiciona segurança e UX.

---

## 🎯 Quando Email é Necessário?

### ✅ Opcional (Funciona sem):
- Onboarding básico (identity_registration + attestation)
- Uso normal da API

### ⚠️ Recomendado:
- Verificação de email (confirma que pessoa controla o email)
- Recovery de conta (se perder chave privada)
- Notificações de segurança (alerta de token emitido)

### 🔒 Necessário para:
- Sistema enterprise (compliance)
- Multi-tenant com convites
- Recovery automático

---

## 📋 Funcionalidades

### 1. Email Verification (Verificação de Email)

**Fluxo:**
```
1. Cliente registra com email
2. Backend envia email com link/token
3. Cliente clica no link → verifica email
4. Span email.verified criado
```

**Span gerado:**
```json
{
  "entity_type": "email.verified",
  "who": "user:self",
  "did": "verified",
  "this": "email.verification",
  "metadata": {
    "email": "dan@voulezvous.com",
    "verification_token": "token_abc123...",
    "verified_at": "2025-11-04T10:00:00Z"
  }
}
```

### 2. Recovery Email (Recuperação de Conta)

**Fluxo:**
```
1. Usuário perde chave privada
2. Solicita recovery via email
3. Backend envia email com link de recovery
4. Cliente clica → processo de recovery (multisig)
```

### 3. Security Notifications (Notificações de Segurança)

**Emails enviados:**
- Token emitido
- Token revogado
- Wallet criado
- Nova chave registrada
- Login de novo dispositivo

### 4. Tenant Invitations (Convites de Tenant)

**Fluxo:**
```
1. Admin cria convite
2. Email enviado com link de onboarding
3. Cliente clica → fluxo de onboarding normal
```

---

## 🏗️ Arquitetura

### Opção 1: AWS SES (Recomendado)

**Vantagens:**
- ✅ Integrado com AWS
- ✅ Barato (62.000 emails/mês grátis)
- ✅ Fácil de configurar
- ✅ Templates HTML

**Desvantagens:**
- ⚠️ Precisa verificar domínio (sandbox inicial)
- ⚠️ Rate limits

### Opção 2: SendGrid / Mailgun (Terceiros)

**Vantagens:**
- ✅ Mais fácil setup inicial
- ✅ Templates prontos
- ✅ Analytics

**Desvantagens:**
- ⚠️ Custo adicional
- ⚠️ Dependência externa

### Opção 3: Lambda + SES (Implementação)

**Componentes:**
- Lambda `email_service` (envia emails)
- DynamoDB `email_verifications` (tokens de verificação)
- AWS SES (envio de emails)
- Templates HTML (em S3 ou inline)

---

## 📝 Implementação Proposta

### Lambda Email Service

**Endpoints:**
- `POST /email/send` - Envia email genérico
- `POST /email/verify/send` - Envia email de verificação
- `POST /email/verify/confirm` - Confirma token de verificação
- `POST /email/recovery/send` - Envia email de recovery

**Environment Variables:**
- `SES_REGION` - Região do SES (us-east-1)
- `FROM_EMAIL` - Email remetente (noreply@loglineos.com)
- `VERIFICATION_TABLE` - DynamoDB table (email_verifications)
- `VERIFICATION_BASE_URL` - URL base para links (https://app.loglineos.com/verify)

---

## 🔄 Fluxo com Email (Opcional)

### Onboarding Completo com Email:

```
1. Cliente registra → identity_registration
2. Backend envia email de verificação
3. Cliente clica no link → email.verified
4. Cliente faz attestation → key_attestation
5. Wallet criado → wallet_opened
6. Token emitido → api_token_issued
7. Email de notificação enviado (opcional)
```

**Diferença:** Adiciona verificação de email antes ou depois do attestation.

---

## 💡 Recomendação

### Para MVP / Beta:
- ❌ **NÃO precisa** de email service
- O onboarding funciona sem email
- Email é apenas metadata (opcional)

### Para Produção:
- ✅ **Recomendado** ter verificação de email
- ✅ **Necessário** para recovery
- ✅ **Bom ter** notificações de segurança

### Para Enterprise:
- ✅ **Obrigatório** verificação de email
- ✅ **Obrigatório** recovery via email
- ✅ **Obrigatório** notificações de segurança

---

## 🚀 Quick Start (Se quiser implementar)

### 1. Setup AWS SES

```bash
# Verificar domínio
aws ses verify-domain-identity --domain loglineos.com

# Verificar email (sandbox)
aws ses verify-email-identity --email-address noreply@loglineos.com
```

### 2. Criar Lambda Email Service

```javascript
// lambda/email_service/index.js
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({ region: process.env.SES_REGION || 'us-east-1' });

async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.VERIFICATION_BASE_URL}/verify?token=${token}`;
  
  await ses.send(new SendEmailCommand({
    Source: process.env.FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Verify your LogLineOS email' },
      Body: {
        Html: { Data: `Click here to verify: <a href="${verificationUrl}">${verificationUrl}</a>` }
      }
    }
  }));
}
```

### 3. Integrar no Auth Service

```javascript
// Após identity_registration
if (email) {
  const token = generateVerificationToken();
  await sendVerificationEmail(email, token);
  // Armazena token no DynamoDB
}
```

---

## 📊 Tabela DynamoDB

### `email_verifications`

```json
{
  "email": "dan@voulezvous.com",
  "token": "verify_abc123...",
  "type": "email_verification",
  "expires_at": 1734048000,
  "status": "pending",
  "created_at": 1730712345
}
```

**PK:** `email`  
**GSI:** `token` (para lookup por token)

---

## ✅ Conclusão

**Resposta curta:** Não precisa para funcionar, mas é recomendado para produção.

**Resposta longa:**
- O onboarding funciona **sem email**
- Email é apenas metadata no `identity_registration`
- Mas ter email service adiciona:
  - ✅ Segurança (verificação)
  - ✅ Recovery (recuperação)
  - ✅ UX (notificações)
  - ✅ Compliance (enterprise)

**Recomendação:** Implementar depois, quando tiver domínio verificado e precisar de recovery/notificações.

---

**Status:** Opcional, não implementado ainda  
**Prioridade:** Baixa (pode ser feito depois)  
**Complexidade:** Média (SES é simples, mas precisa verificar domínio)

