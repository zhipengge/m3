# m3 bash completion — add to ~/.bashrc: eval "$(m3 completion bash)"
# or: m3 completion install

_m3_completion() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  local commands="build chat gateway agent doctor status install channels webchat completion"
  local gateway_sub="stop"
  local channel_sub="configure list scan remove"

  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )
    return
  fi

  case "${COMP_WORDS[1]}" in
    gateway)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "${gateway_sub}" -- "${cur}") )
        return
      fi
      if [[ ${COMP_WORDS[2]} == stop ]]; then
        COMPREPLY=( $(compgen -W "--config" -- "${cur}") )
        return
      fi
      COMPREPLY=( $(compgen -W "--mock --port --config -i --interactive" -- "${cur}") )
      ;;
    chat|webchat)
      COMPREPLY=( $(compgen -W "--mock --port --config --peer" -- "${cur}") )
      ;;
    channels)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "${channel_sub}" -- "${cur}") )
        return
      fi
      if [[ ${COMP_WORDS[2]} == remove ]]; then
        if [[ ${prev} == --channel ]]; then
          COMPREPLY=( $(compgen -W "feishu slack webchat" -- "${cur}") )
        else
          COMPREPLY=( $(compgen -W "--channel --account --config" -- "${cur}") )
        fi
        return
      fi
      COMPREPLY=( $(compgen -W "--config --port" -- "${cur}") )
      ;;
    agent)
      COMPREPLY=( $(compgen -W "-p --print --mock --model --config" -- "${cur}") )
      ;;
    completion)
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "zsh bash install" -- "${cur}") )
      fi
      ;;
    *)
      COMPREPLY=( $(compgen -W "--config" -- "${cur}") )
      ;;
  esac
}

complete -o default -o nospace -F _m3_completion m3
