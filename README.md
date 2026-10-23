# Radar de Condições AD — Netlify com código por e-mail

Projeto preparado a partir de Condições Bancárias | Laboratório AD, versão do repositório 3dfe8ad99db4a56f26844685af95752ab3453cb8. Mantém o comparador, os filtros, rankings, importação de planilhas, exportação e relatório de referência. Esta é uma cópia para Netlify; o Site ChatGPT original não foi alterado nem republicado.

## Resultado esperado
1. Pessoa informa seu e-mail @adpromotora.com.br.
2. Supabase envia código de seis números.
3. Pessoa informa o código.
4. Backend verifica o código, a identidade confirmada e o domínio exato.
5. Uma sessão de até 30 minutos libera o painel; Sair encerra a sessão local.

A regra não aceita subdomínios ou endereços com sufixos semelhantes. O código não é gerado nem validado no navegador. Não depende de conta do ChatGPT. Os dados da referência ficam fora da pasta pública e só são servidos depois da verificação do servidor. O cookie é HttpOnly, Secure e SameSite=Lax; não há token em localStorage.

## Antes de publicar: configurar a autenticação
Crie um projeto Supabase independente para este laboratório, evitando alterar a autenticação do Dashboard Incentivos.

No Supabase:
- Habilite autenticação por e-mail e o cadastro de novos usuários, para que qualquer funcionário com e-mail elegível possa receber seu primeiro código.
- Configure código de e-mail com 6 dígitos e expiração de 1800 segundos (30 minutos). O código perde validade após o uso, conforme o provedor.
- Mantenha as confirmações de e-mail habilitadas. Não habilite confirmação automática.
- Em Authentication → Email Templates (os nomes podem variar), personalize os modelos Magic Link E Confirm signup para conter {{ .Token }}, usando o modelo EMAIL_CODIGO.html deste pacote. Isso cobre usuários já cadastrados e primeiro acesso. O template apenas mostra o token; o tamanho de seis dígitos é uma configuração da autenticação, não do HTML.
- Configure SMTP próprio, remetente autorizado e as exigências de verificação de domínio do seu provedor. Sem SMTP, o envio padrão do Supabase não atende funcionários que não pertençam à equipe administrativa do projeto.
- Confira limites de reenvio e verificação no Supabase; mantenha ao menos 60 segundos entre solicitações de código e limites de tentativas habilitados. A interface também aguarda 60 segundos para reenvio; o controle real de frequência e tentativas é do serviço de autenticação.
- Configure a Site URL com a URL definitiva do Netlify. Este projeto usa código, sem callback de magic link.

Referências oficiais:
https://supabase.com/docs/guides/auth/auth-email-passwordless
https://supabase.com/docs/guides/auth/auth-email-templates
https://supabase.com/docs/guides/auth/auth-smtp
https://supabase.com/docs/guides/local-development/cli/config

## Configurar o Netlify
1. Crie um repositório Git para esta cópia e envie TODO o conteúdo deste pacote na raiz, preservando as pastas. O netlify.toml deve ficar na raiz. Não envie somente public ou somente private-site.
2. Conecte esse repositório ao Netlify por Import from Git. O upload manual de uma pasta de site estático não prepara as funções deste projeto.
3. Use Build command: npm run build; Publish directory: public; Functions directory: netlify/functions. O netlify.toml já define isso.
4. Nas variáveis de ambiente do Netlify, com acesso para Functions/runtime, cadastre:
   - SUPABASE_URL: URL do novo projeto, como https://SEU-PROJETO.supabase.co.
   - SUPABASE_PUBLISHABLE_KEY: chave publicável do projeto (ou a chave anon legada). Não usar service_role.
   - SESSION_SECRET: segredo aleatório de pelo menos 32 caracteres. Gere pelo gerenciador de senhas ou, opcionalmente, execute node scripts/gerar-segredo.mjs localmente. Não envie o segredo por chat nem para o GitHub.
5. Execute um novo deploy após salvar as variáveis. Sem elas o acesso falha fechado, sem expor o painel ou os dados.
6. Não configure o deploy para dist, não mova os arquivos privados para public e não remova a regra de redirecionamento forçado.

A função usa Node 22, sem dependências npm adicionais. Dados são enviados em gzip, pois o relatório bruto tem cerca de 18 MB e as funções possuem limite de resposta. O arquivo comprimido tem aproximadamente 868 KB; não altera os valores. A build interrompe se ele exceder o limite seguro definido.

## Estrutura
public/                       Somente mensagem técnica de fallback; sem relatório.
private-site/                 Aplicação original e base seed.json.gz protegidas.
netlify/functions/portal.mjs   Entrada do backend para todas as rotas.
server/                       Validação de sessão, autorização e tela de login.
tests/                        Testes locais sem chamadas externas.

## Publicação e teste real
Ainda não foi publicado no Netlify e nenhum e-mail real foi enviado. Depois de configurar os serviços:
- Em janela anônima, abra a URL: deve exigir login.
- Tente e-mail de outro domínio: deve bloquear.
- Peça o código para e-mail corporativo e confira a entrega.
- Código inválido ou já utilizado deve bloquear.
- Com o código correto, confira o comparador e importação/exportação.
- Clique em Sair e tente abrir /seed.json, /app.js e /.netlify/functions/portal?resource=seed.json diretamente: devem negar acesso sem sessão.
- Confira expiração do código de 30 minutos na configuração real do Supabase. Testes locais não comprovam a configuração externa.

## Verificação feita nesta entrega
npm test: 15 testes do backend/autenticação com provedor simulado aprovados, mais testes existentes do motor de condições e filtros de produto aprovados.
npm run build: estrutura de publicação, arquivos privados e limite do gzip aprovados.
Testes incluem domínio exato, código de seis dígitos, confirmação da identidade, cookie assinado, adulteração, expiração, bloqueio sem login, tentativa de acesso direto à função, arquivos internos, saída e indisponibilidade do provedor. Nada foi enviado ao Supabase ou SMTP real. Teste da configuração de redirects, embalagem de arquivos e cookies no runtime real do Netlify permanece pendente de publicação.

Importações de novas planilhas continuam no navegador e não são persistidas entre recarregamentos, como no projeto original. A configuração de autenticação não cria conexão com Notion, SharePoint ou com o Dashboard Incentivos.
