#!/usr/bin/env bash
# WARNING: This script will delete all files and folders in the current directory.
# Run this only if you really intend to remove the project files.
# Example: chmod +x delete_all.sh && ./delete_all.sh

set -euo pipefail

echo "This will delete everything in the current directory: $(pwd)"
read -p "Type 'YES' to confirm irreversible deletion: " confirm
if [ "$confirm" != "YES" ]; then
  echo "Aborted. No files were deleted."
  exit 1
fi

# Attempt to be safe when run in a risky location: refuse obvious unsafe roots.
if [ "$PWD" = "/" ] || [ "$PWD" = "/root" ] || [ "$PWD" = "/home" ] || [ "$PWD" = "/usr" ]; then
  echo "Refusing to run in a protected system directory: $PWD"
  exit 1
fi

# Proceed to delete all non-hidden files and directories in current directory,
# then delete hidden files (but preserve this script until the end).
shopt -s extglob
echo "Deleting non-hidden files and directories..."
rm -rf -- ./* ./*/** || true

echo "Deleting hidden files and directories (including dotfiles)..."
# Remove hidden entries except '.' and '..'
for entry in .[^.]* ..?*; do
  # skip if the entry is this script
  if [ -e "$entry" ] && [ "$(realpath "$entry")" != "$(realpath "$0")" ]; then
    rm -rf -- "$entry" || true
  fi
done

echo "All user-visible project files deleted from $(pwd)."
echo "Finally removing this script..."
rm -f -- "$0" || true

echo "Done."