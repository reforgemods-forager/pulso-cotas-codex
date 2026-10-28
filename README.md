# Pulso — Cotas do Codex

Monitor pessoal e local para Windows. Mostra percentuais disponíveis e horários reais das janelas retornadas pelo Codex; consulta a cada minuto. Não envia prompts e não tenta provocar ou consumir resets.

## Abrir

Clique duas vezes em **Iniciar.vbs** (ou Iniciar.cmd). O painel abre em http://127.0.0.1:43821 e o monitor permanece em segundo plano ao fechar a página.

Requisitos: Windows, Node.js 22 ou superior e Codex CLI. Neste computador, os requisitos foram encontrados. Não é necessário instalar pacotes npm para este projeto. Para outra instalação do Codex, a variável opcional `PULSO_CODEX_JS` aponta para o arquivo bin/codex.js oficial.

Nenhuma conta é adicionada automaticamente. Clique em **Adicionar conta**, dê um nome e entre no site oficial da OpenAI. Repita para cada conta. Confira o e-mail mostrado após cada login. Só faça um login de cada vez, pois o Codex usa um retorno local para concluir a autorização.

## Continuidade

- O Codex gerencia a renovação de credenciais. Novas contas usam armazenamento `keyring` do Windows, separado por diretório de perfil. Essa autorização ainda pode expirar ou ser revogada pela OpenAI: quando isso acontecer, será necessário reconectar.
- Falhas de conexão geram tentativas após 1, 2, 5 e até 15 minutos. A partir da segunda falha, o processo de consulta é recriado. Três falhas seguidas geram aviso de sincronização; exigência de login gera aviso imediato.
- Após três minutos sem leitura válida, o painel identifica o saldo como desatualizado. Uma falha nunca é convertida em 0% ou em reset.
- Um supervisor verifica o serviço a cada 10 segundos e o reinicia em caso de encerramento ou três falhas de saúde consecutivas. Ele impede que duas instâncias do supervisor rodem ao mesmo tempo.
- Em **Preferências**, habilite iniciar ao entrar no Windows. O monitor não consulta enquanto o computador está desligado, suspenso ou sem internet. Após retomar, registra mudanças observadas sem inventar a hora exata em que aconteceram.
- Um reset só gera registro após uma recuperação observada do saldo. Aumento parcial aparece como recuperação; retorno quase completo antes do horário anterior aparece como recuperação antecipada. A causa não é conhecida.
- Alertas nativos funcionam sem o painel aberto. Verifique **Enviar teste** e as configurações de notificações/Não perturbe do Windows. O envio aceito pelo Windows não comprova que você viu o aviso.

## Privacidade e arquivos

O servidor escuta somente em 127.0.0.1 e verifica host, origem, cookie local e proteção contra solicitações de outros sites. Não publique este servidor pessoal na internet.

Os registros ficam em `%LOCALAPPDATA%\PulsoCotas\state.json` e contêm rótulos, e-mails, planos, saldos, horários e até 300 eventos. Tokens e senhas não são retornados ao navegador nem salvos nesse arquivo. Os novos logins são gerenciados pelo Codex no Windows Credential Manager. Cada conta adicionada pelo painel tem uma sessão independente do Codex usado no terminal ou desktop.

Remover uma conta própria chama o logout do Codex antes de removê-la. Em instalações antigas que ainda tenham uma conta emprestada do desktop, removê-la apenas a tira do painel, preservando o login do Codex instalado. Para parar, use **Preferências → Encerrar**. Para impedir reinício no próximo login, desative primeiro a opção de início automático.

## Verificar

Execute `npm test` nesta pasta. Os testes verificam classificação de resets, recuperação parcial, janelas ausentes, normalização dos saldos e proteções HTTP. Não comprovam estabilidade de semanas nem o login em contas que ainda não foram conectadas.

Documentação: https://learn.chatgpt.com/docs/app-server

## Aparência e idioma

O cabeçalho acompanha a rolagem. Os botões no topo controlam a barra lateral, o tema claro/preto, a privacidade dos e-mails e o idioma (português brasileiro, inglês ou espanhol). Essas preferências ficam neste navegador. O lápis ao lado de cada nome permite renomear a conta; o nome é salvo pelo monitor. As notificações nativas do Windows continuam em português.

## Período do Plus

O calendário no rodapé de cada cartão permite registrar o fim do período atual ou a próxima renovação. A consulta `account/read` do Codex usada neste projeto retorna tipo de conta, e-mail e tipo do plano; não fornece a data da assinatura. Por isso, as datas são cadastradas pelo usuário, identificadas como manuais e não são avançadas automaticamente. Consulte a assinatura no ChatGPT antes de preencher e confira a conta selecionada. A expiração de tokens e o reset de cotas não são usados como vencimento do Plus.
