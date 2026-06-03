#!/usr/bin/env bash
# m3 one-line install (macOS). Usage: curl -fsSL ... | bash  OR  ./install.sh
set -euo pipefail

M3_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_BIN="${HOME}/.local/bin"
COMPLETION_DIR="${HOME}/.m3/completions"

echo "==> m3 install (${M3_ROOT})"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Warning: optimized for macOS; other platforms may work but are untested."
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

need_cmd node
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "Node.js 22+ required (found $(node -v))"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> enabling pnpm via corepack"
  need_cmd corepack
  corepack enable
  corepack prepare pnpm@latest --activate
fi

echo "==> pnpm install"
cd "${M3_ROOT}"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> pnpm build"
pnpm build

mkdir -p "${INSTALL_BIN}" "${COMPLETION_DIR}" "${HOME}/.m3"

WRAPPER="${INSTALL_BIN}/m3"
cat > "${WRAPPER}" <<EOF
#!/usr/bin/env bash
export M3_HOME="${M3_ROOT}"
exec node "\${M3_HOME}/packages/cli/dist/cli.js" "\$@"
EOF
chmod +x "${WRAPPER}"

mkdir -p "${HOME}/.zfunc"
cp "${M3_ROOT}/scripts/completions/m3.zsh" "${HOME}/.zfunc/_m3"
cp "${M3_ROOT}/scripts/completions/m3.bash" "${COMPLETION_DIR}/m3.bash"

if [[ -f "${HOME}/.zshrc" ]]; then
  if ! grep -q '\.zfunc' "${HOME}/.zshrc" 2>/dev/null; then
    echo "" >> "${HOME}/.zshrc"
    echo "# m3 tab completion" >> "${HOME}/.zshrc"
    echo 'fpath=(~/.zfunc $fpath)' >> "${HOME}/.zshrc"
    echo "==> added fpath ~/.zfunc to ~/.zshrc"
  fi
  if ! grep -q 'compinit' "${HOME}/.zshrc" 2>/dev/null; then
    echo 'autoload -Uz compinit && compinit' >> "${HOME}/.zshrc"
    echo "==> added compinit to ~/.zshrc"
  fi
fi

BASH_LINE='eval "$(m3 completion bash)"'
if [[ -f "${HOME}/.zshrc" ]] && ! grep -q 'm3 completion' "${HOME}/.zshrc" 2>/dev/null; then
  :
fi
if [[ -f "${HOME}/.bash_profile" ]] && ! grep -q 'm3 completion' "${HOME}/.bash_profile" 2>/dev/null; then
  echo "" >> "${HOME}/.bash_profile"
  echo "# m3 tab completion" >> "${HOME}/.bash_profile"
  echo "${BASH_LINE}" >> "${HOME}/.bash_profile"
  echo "==> added m3 completion to ~/.bash_profile"
fi

if [[ ":${PATH}:" != *":${INSTALL_BIN}:"* ]]; then
  echo ""
  echo "Add to your shell profile:"
  echo "  export PATH=\"${INSTALL_BIN}:\$PATH\""
fi

if [[ ! -f "${HOME}/.m3/m3.json" ]]; then
  cp "${M3_ROOT}/examples/m3.json" "${HOME}/.m3/m3.json"
  echo "==> created ~/.m3/m3.json from examples"
fi

echo ""
echo "Done. Restart your shell, then:"
echo "  m3 status"
echo "  m3 doctor"
echo "  m3 channels scan    # bind Feishu / WeChat (WeChat coming soon)"
echo "  m3                  # interactive terminal (same as m3 chat)"
echo "  m3 completion install && exec zsh   # enable tab completion"
echo "  open http://127.0.0.1:18790/dashboard"
