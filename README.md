# Jogo do Galo Online

Aplicação Node.js + Socket.IO para jogar Jogo do Galo em salas privadas, com chat e videochamada entre dois jogadores.

## Publicar no GitHub e Render

1. Extraia este ZIP no computador.
2. Crie um repositório novo no GitHub e carregue todos os ficheiros e a pasta `public`.
3. No Render, escolha **New + > Web Service** e ligue o repositório.
4. O Render deteta o `package.json`. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Em **Environment**, crie `ADMIN_PASSWORD` e coloque a sua palavra-passe. Não a coloque no código nem a envie por WhatsApp.
6. Faça deploy e abra o endereço HTTPS que o Render atribuir.

## Como jogar

- Abra o site e escolha **Criar sala**; introduza a palavra-passe de administrador configurada no Render.
- Envie o link/código da sala à outra pessoa pelo WhatsApp.
- O primeiro jogador fica com X e o segundo com O.
- O chat está disponível dentro da sala.
- Para a chamada, ambos devem carregar em **Ativar câmara e microfone** e aceitar as permissões do navegador. O acesso à câmara/microfone depende do dispositivo e da ligação HTTPS.
- Se um jogador recarregar a página, pode voltar a entrar com o código da sala.

## Notas importantes

- A sala e as partidas ficam na memória do servidor; reiniciar ou suspender o serviço pode apagar salas ativas.
- Para este projeto, a autenticação de administrador usa `ADMIN_PASSWORD`. Use uma palavra-passe forte.
- A videochamada usa WebRTC com sinalização Socket.IO. A ligação pode falhar em algumas redes restritas sem servidor TURN; o jogo e o chat continuam a funcionar.
- Não partilhe a palavra-passe de administrador; partilhe apenas o link/código da sala.