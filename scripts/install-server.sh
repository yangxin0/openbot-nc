#!/bin/bash
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

release_source=""
release_sha512=""
service_user=""
auth_api_url=""
display_size=""
identity_file=""
server_name=""

fail() {
  echo "$*" >&2
  exit 1
}

fetch() {
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --retry 3 "$@"
}

usage() {
  cat <<'EOF'
Installs OpenBot as a self-hosted server on a Linux computer with no screen:

  sudo bash install-server.sh --release <AppImage file or https URL> [options]

Options:
  --release <file or URL>   Required. The OpenBot AppImage to install: a local file path, or an
                            https URL that you choose. This script downloads nothing else.
  --sha512 <base64>         The SHA-512 of the AppImage, in base64. When you give it, the install
                            stops if the file does not match.
  --user <name>             The user that runs OpenBot and its agents. Default: the user of the
                            installed server, else openbot, which the install makes when it does
                            not exist.
  --auth-api-url <origin>   Another account server, for development. Default: the one of the
                            installed server, else the one in the build.
  --display-size <W>x<H>    The size of the virtual display that computer use reads, from 640x480
                            to 2576x2576. Default: the one of the installed server, else 1280x800.
  --name <name>             The server name. Default: OpenBot.
  --identity <file>         The identity file of this server, from the "ca issue" command of your
                            relay server. The install imports it and shares the agents of the
                            server with the team. The user that runs OpenBot must be able to read it.

The install steps come from the AppImage that you give
(resources/hosting/openbot-server-setup), so they always match the build that they install.
To update the server later, run: sudo /opt/OpenBot-NC/hosted/openbot-hosted-update stage <file or URL>
See docs/self-hosted-server.md.
EOF
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --release)
      [ "$#" -ge 2 ] || fail "Add an AppImage file or an https URL after --release."
      release_source=$2
      shift 2
      ;;
    --sha512)
      [ "$#" -ge 2 ] || fail "Add a SHA-512 in base64 after --sha512."
      release_sha512=$2
      shift 2
      ;;
    --user)
      [ "$#" -ge 2 ] || fail "Add a user name after --user."
      service_user=$2
      shift 2
      ;;
    --auth-api-url)
      [ "$#" -ge 2 ] || fail "Add a URL after --auth-api-url."
      auth_api_url=$2
      shift 2
      ;;
    --display-size)
      [ "$#" -ge 2 ] || fail "Add a size, such as 1920x1080, after --display-size."
      display_size=$2
      shift 2
      ;;
    --name)
      [ "$#" -ge 2 ] || fail "Add a server name after --name."
      server_name=$2
      shift 2
      ;;
    --identity)
      [ "$#" -ge 2 ] || fail "Add the path of the identity file after --identity."
      identity_file=$(readlink -f "$2") && [ -f "$identity_file" ] || fail "$2 is not a file."
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $1" ;;
  esac
done
[ -n "$release_source" ] || fail "Add the OpenBot AppImage with --release <file or https URL>. Run with --help for the options."
[ "$(uname -s)" = Linux ] || fail "This install is for Linux."
[ "$(id -u)" -eq 0 ] || fail "Run this with sudo."
[ -d /run/systemd/system ] || fail "OpenBot needs systemd."
command -v apt-get >/dev/null || fail "OpenBot needs Ubuntu 24.04 or a newer Ubuntu or Debian."
# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  echo "OpenBot is tested on Ubuntu 24.04. This is ${PRETTY_NAME:-an unknown system}; the install continues." >&2
fi
case $(uname -m) in
  x86_64 | aarch64) ;;
  *) fail "OpenBot has no release for this machine." ;;
esac

missing=()
for command in curl openssl; do command -v "$command" >/dev/null || missing+=("$command"); done
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get -o DPkg::Lock::Timeout=600 update
  apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends ca-certificates "${missing[@]}"
fi

work=$(mktemp -d /var/tmp/openbot-install.XXXXXX)
trap 'rm -rf "$work"' EXIT
case $release_source in
  https://*)
    echo "Downloading $release_source..."
    fetch --output "$work/OpenBot.AppImage" "$release_source"
    ;;
  *)
    [ -f "$release_source" ] || fail "$release_source is not a file or an https URL."
    cp -- "$release_source" "$work/OpenBot.AppImage"
    ;;
esac
if [ -n "$release_sha512" ]; then
  [ "$(openssl dgst -sha512 -binary "$work/OpenBot.AppImage" | openssl base64 -A)" = "$release_sha512" ] ||
    fail "The AppImage does not match the SHA-512."
fi
chmod 0700 "$work/OpenBot.AppImage"
(cd "$work" && ./OpenBot.AppImage --appimage-extract >/dev/null)
version=$(sed -n 's/^X-AppImage-Version=//p' "$work"/squashfs-root/*.desktop 2>/dev/null | head -n 1)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The AppImage has no valid version."

setup="$work/squashfs-root/resources/hosting/openbot-server-setup"
[ -f "$setup" ] || fail "OpenBot $version cannot install as a server."
if [ -n "$display_size" ] && ! grep -q OPENBOT_DISPLAY_SIZE "$setup"; then
  fail "OpenBot $version has no --display-size. Install without it."
fi
bash "$setup" "$service_user" "$work/squashfs-root" "$auth_api_url" ${display_size:+"$display_size"}

if [ -n "$server_name" ]; then openbot-nc name "$server_name" >/dev/null; fi
if [ -n "$identity_file" ]; then
  echo
  openbot-nc import-identity "$identity_file" --hosting on
  exit 0
fi

cat <<'EOF'

Next, import the identity file of this server, from the "ca issue" command of your relay server:

  sudo openbot-nc import-identity <file> --hosting on

Other commands: openbot-nc status, openbot-nc logs. Run "openbot-nc help" for all.
EOF
