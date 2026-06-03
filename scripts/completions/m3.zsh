#compdef m3
# m3 zsh completion — install: m3 completion install

_m3() {
  local -a commands
  commands=(
    'build:Build all packages'
    'chat:Gateway + terminal REPL (Claude Code-style)'
    'gateway:Start gateway daemon'
    'agent:Headless agent (-p required)'
    'doctor:Check install and config'
    'status:Gateway / port status'
    'install:Run install.sh'
    'channels:Configure Feishu / Slack / WebChat'
    'webchat:Local webchat test REPL'
    'completion:Shell completion scripts'
  )

  if (( CURRENT == 1 )); then
    _describe 'm3 command' commands
    return
  fi

  case $words[1] in
    gateway)
      if (( CURRENT == 2 )); then
        _describe 'gateway subcommand' '(stop)'
        return
      fi
      if [[ $words[2] == stop ]]; then
        _arguments '--config[Config file path]'
        return
      fi
      _arguments \
        '--mock[Use mock agent]' \
        '--port[Gateway port]' \
        '--config[Config file path]' \
        '(-i --interactive)'{-i,--interactive}'[Terminal REPL]'
      ;;
    chat|webchat)
      _arguments \
        '--mock[Use mock agent]' \
        '--port[Gateway port]' \
        '--config[Config file path]' \
        '--peer[WebChat peer id]'
      ;;
    agent)
      _arguments \
        '-p[Print mode]' \
        '--print[Print mode]' \
        '--mock[Use mock agent]' \
        '--model[Model ref]' \
        '--config[Config file path]'
      ;;
    channels)
      if (( CURRENT == 2 )); then
        _describe 'channels subcommand' '(configure:list:scan:remove)'
        return
      fi
      case $words[2] in
        configure|setup|list|scan)
          _arguments '--config[Config file path]' '--port[Scan server port]'
          ;;
        remove)
          _arguments \
            '--channel[Channel id]:channel:(feishu slack webchat)' \
            '--account[Account id]' \
            '--config[Config file path]'
          ;;
      esac
      ;;
    completion)
      if (( CURRENT == 2 )); then
        _describe 'shell' '(zsh bash install)'
        return
      fi
      ;;
    doctor|status|build|install)
      _arguments '--config[Config file path]'
      ;;
  esac
}
