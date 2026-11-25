# Baixar vídeos do Telegram

O comando sincroniza o histórico de vídeos acessível à conta no **Canal de Vídeos para Afiliados . Ele também reconhece vídeos enviados como arquivos.

1. Na pasta do projeto, instale as dependências com `npm install`.
2. Na mesma pasta, copie `env.example.json` para `env.json` e preencha `apiId` e `apiHash`, obtidos em [API development tools](https://my.telegram.org).
3. Execute `npm start`. No primeiro login, informe o telefone, o código e, se solicitado, a senha em duas etapas no terminal.

Os vídeos ficam em `dados/videos/`. O bot grava em `dados/baixados.json` o ID do canal e, para cada mensagem baixada, o ID do vídeo, o nome do arquivo e o tamanho em bytes. Execute o mesmo comando para buscar a diferença. Se um arquivo registrado estiver ausente ou incompleto, o bot tenta baixá-lo novamente. Uma falha individual fica pendente para a próxima execução.

Se houver canais com o mesmo título, inclua em `env.json` a propriedade opcional `channelId` com o ID numérico do canal como texto, sem o prefixo `-100`. A sessão de login fica em `dados/session`. Mantenha essa pasta e `env.json` privados.

Se uma interrupção abrupta deixar `dados/execucao.lock`, confira se o processo com o PID gravado no arquivo já terminou antes de remover o bloqueio e executar novamente.
