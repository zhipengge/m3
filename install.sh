#!/usr/bin/env bash
# One-shot install: build, ~/.local/bin/m3, ~/.m3 config skeleton, PATH.
# Optional: ./install.sh --with-completion
set -euo pipefail

M3_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_BIN="${HOME}/.local/bin"
M3_HOME="${HOME}/.m3"
WITH_COMPLETION=false
SKIP_BUILD=false

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

  (default)  pnpm install + build, install m3 to ~/.local/bin, init ~/.m3
  --with-completion   also install shell tab completion (zsh/bash)
  --skip-build        skip pnpm install/build (dev iteration)
  -h, --help          show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-completion) WITH_COMPLETION=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Need Node.js >= 22.19 (https://nodejs.org)" >&2
    exit 1
  fi
  local major minor
  major="$(node -p "process.versions.node.split('.')[0]")"
  minor="$(node -p "process.versions.node.split('.')[1]")"
  if [[ "$major" -lt 22 ]] || [[ "$major" -eq 22 && "$minor" -lt 19 ]]; then
    echo "Need Node.js >= 22.19 (current: $(node -v))" >&2
    exit 1
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate
    return
  fi
  echo "Need pnpm (npm i -g pnpm, or Node with corepack)" >&2
  exit 1
}

build_m3() {
  cd "$M3_ROOT"
  pnpm install
  pnpm run build
}

install_wrapper() {
  mkdir -p "$INSTALL_BIN"
  cat >"${INSTALL_BIN}/m3" <<EOF
#!/usr/bin/env bash
export M3_ROOT="${M3_ROOT}"
exec node "\${M3_ROOT}/bin/m3.js" "\$@"
EOF
  chmod +x "${INSTALL_BIN}/m3"
}

init_config() {
  mkdir -p "$M3_HOME"
  if [[ ! -f "${M3_HOME}/m3.json" ]]; then
    cp "${M3_ROOT}/examples/m3.json" "${M3_HOME}/m3.json"
    echo "Created ${M3_HOME}/m3.json"
  fi
  if [[ ! -f "${M3_HOME}/secrets.json" ]]; then
    cp "${M3_ROOT}/examples/secrets.json.example" "${M3_HOME}/secrets.json"
    chmod 600 "${M3_HOME}/secrets.json"
    echo "Created ${M3_HOME}/secrets.json — add your API keys"
  fi
}

M3_PROFILE=""

ensure_path() {
  case "${SHELL:-}" in
    */zsh) M3_PROFILE="${HOME}/.zshrc" ;;
    */bash)
      M3_PROFILE="${HOME}/.bash_profile"
      [[ -f "${HOME}/.bashrc" ]] && M3_PROFILE="${HOME}/.bashrc"
      ;;
  esac
  if [[ -n "$M3_PROFILE" ]] && { [[ -f "$M3_PROFILE" ]] || [[ -w "$(dirname "$M3_PROFILE")" ]]; }; then
    touch "$M3_PROFILE" 2>/dev/null || return 0
    if ! grep -q '# m3 PATH' "$M3_PROFILE" 2>/dev/null; then
      {
        echo ''
        echo '# m3 PATH'
        echo "export PATH=\"${INSTALL_BIN}:\$PATH\""
      } >>"$M3_PROFILE"
      echo "Added ${INSTALL_BIN} to ${M3_PROFILE}"
    fi
  else
    echo "Could not update shell profile — add to PATH manually:"
    echo "  export PATH=\"${INSTALL_BIN}:\$PATH\""
  fi
}

m3_bin() {
  echo "${INSTALL_BIN}/m3"
}

install_completion_optional() {
  local shell="bash"
  [[ "${SHELL:-}" == *zsh* ]] && shell="zsh"
  "$(m3_bin)" completion install --shell "$shell" || true
}

main() {
  need_node
  ensure_pnpm
  if [[ "$SKIP_BUILD" == false ]]; then
    echo "Building m3..."
    build_m3
  fi
  install_wrapper
  init_config
  ensure_path
  if [[ "$WITH_COMPLETION" == true ]]; then
    install_completion_optional
  fi

  local m3_cmd
  m3_cmd="$(m3_bin)"

  echo ""
  echo "Done. Next:"
  echo "  1. Edit ${M3_HOME}/secrets.json (API keys)"
  echo "  2. Run m3 (this shell does not have PATH yet — pick one):"
  echo "       ${m3_cmd}"
  if [[ -n "$M3_PROFILE" && -f "$M3_PROFILE" ]]; then
    echo "       source ${M3_PROFILE} && m3"
  else
    echo "       export PATH=\"${INSTALL_BIN}:\$PATH\" && m3"
  fi
  echo "     New terminals can use: m3"
  if [[ "$WITH_COMPLETION" == false ]]; then
    echo "  (optional) ./install.sh --with-completion"
  fi
}

main
