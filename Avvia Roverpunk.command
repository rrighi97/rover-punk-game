#!/bin/zsh
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install || exit 1
fi

# Avvia il server, attendi che sia pronto e apri la plancia nel browser.
npm run dev &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null
}
trap cleanup EXIT INT TERM

until curl --silent --fail http://localhost:5173/api/state >/dev/null 2>&1; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Il server Roverpunk non è riuscito ad avviarsi."
    exit 1
  fi
  sleep 0.2
done

open "http://localhost:5173"
wait "$server_pid"
