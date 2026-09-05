#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:-$repo_root/dist/pi-browser-tools-kit}"
tool_dir="$out_dir/files/workspace/browser-tools"
skill_dir="$out_dir/files/workspace/.agents/skills/browser-tools"
tools=(start status nav eval screenshot dom click type wait pick cookies)

rm -rf "$out_dir"
mkdir -p "$tool_dir/lib" "$skill_dir"

cp "$repo_root/docker-kit/spec.yaml" "$out_dir/spec.yaml"
cp "$repo_root/docker-kit/host.Makefile" "$out_dir/host.Makefile"
cp -R "$repo_root/docker-kit/host" "$out_dir/host"
for tool in "${tools[@]}"; do
  cp "$repo_root/browser-tools/$tool.js" "$tool_dir/$tool.js"
done
cp "$repo_root/browser-tools/lib/cdp.js" "$tool_dir/lib/cdp.js"
cp "$repo_root/README.md" "$tool_dir/README.md"
cp "$repo_root/skills/browser-tools/SKILL.md" "$skill_dir/SKILL.md"

for tool in "${tools[@]}"; do
  chmod +x "$tool_dir/$tool.js"
done
chmod +x "$out_dir/host/start-chrome-debug.sh" "$out_dir/host/cdp-relay.js"

echo "$out_dir"
