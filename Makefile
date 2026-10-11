UUID := $(shell sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
ZIP  := $(UUID).shell-extension.zip

.PHONY: pack install clean

# Zip for upload to extensions.gnome.org
pack: $(ZIP)

$(ZIP): extension.js metadata.json
	gnome-extensions pack --force --extra-source=LICENSE .

# Install into ~/.local/share for testing outside Nix; log out and in afterwards
install: pack
	gnome-extensions install --force $(ZIP)

clean:
	rm -f $(ZIP)
