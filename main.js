"use strict";

const {
	AbstractInputSuggest,
	FuzzySuggestModal,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
} = require("obsidian");

const VIEW_TYPE = "dishonored-dunwall";

const PLATES = [
	{ id: "heart", name: "The Heart", role: "Quick switcher" },
	{ id: "map", name: "The Map", role: "Graph" },
	{ id: "journal", name: "The Journal", role: "Daily note" },
	{ id: "mark", name: "The Mark", role: "Command palette" },
	{ id: "ledger", name: "The Ledger", role: "Financials" },
	{ id: "contract", name: "The Contract", role: "Work" },
];

const ACTION_HINTS = {
	heart: "Opens the quick switcher. Change the type and target to point somewhere else. Clear the target to restore this.",
	map: "Opens the graph. Change the type and target to point somewhere else. Clear the target to restore this.",
	journal: "Opens today's daily note. Change the type and target to point somewhere else. Clear the target to restore this.",
	mark: "Opens the command palette. Change the type and target to point somewhere else. Clear the target to restore this.",
	ledger: "Does nothing until a note, folder, or command is set, you could point it to your financials folder",
	contract: "Does nothing until a note, folder, or command is set, you could point it to your work folder",
};

const DEFAULT_SETTINGS = {
	actions: {
		heart: { type: "command", target: "switcher:open" },
		map: { type: "command", target: "graph:open" },
		journal: { type: "command", target: "daily-notes:goto-today" },
		mark: { type: "command", target: "command-palette:open" },
		ledger: { type: "note", target: "" },
		contract: { type: "note", target: "" },
	},
};

const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;

const MARKS = {
	ribbon:
		'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h10v13l-5-3-5 3z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
	page:
		'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h6l3 3V14.5H4zM10 1.5V5h3.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
};

const SUGGEST_CAP = 50;

function suggestionText(item) {
	if (!item || typeof item === "string") {
		return item || "";
	}
	return item.name ? `${item.name}  ${item.id}` : item.id;
}

function isFolder(file) {
	return file instanceof TFolder || (file && Array.isArray(file.children) && !file.extension);
}

function folderList(app) {
	if (typeof app.vault.getAllLoadedFiles === "function") {
		return app.vault.getAllLoadedFiles().filter((file) => isFolder(file));
	}
	const found = [];
	const walk = (folder) => {
		for (const child of folder.children || []) {
			if (isFolder(child)) {
				found.push(child);
				walk(child);
			}
		}
	};
	const root = app.vault.getRoot();
	if (root) {
		found.push(root);
		walk(root);
	}
	return found;
}

function folderPath(folder) {
	if (!folder || !folder.path || folder.path === "/") {
		return "";
	}
	return folder.path;
}

function cleanFolder(value) {
	return String(value || "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

function imageFiles(app, folder) {
	const prefix = cleanFolder(folder);
	return app.vault.getFiles().filter((file) => {
		if (!IMAGE_FILE.test(file.path)) {
			return false;
		}
		if (!prefix) {
			return !file.path.includes("/");
		}
		const rest = file.path.slice(prefix.length + 1);
		return file.path.startsWith(`${prefix}/`) && rest && !rest.includes("/");
	});
}

function notePaths(app) {
	return app.vault.getMarkdownFiles().map((file) => file.path);
}

function commandItems(app) {
	const commands = app.commands && app.commands.commands;
	if (!commands) {
		return [];
	}
	return Object.values(commands).map((command) => ({
		id: command.id,
		name: command.name || command.id,
	}));
}

function commitInput(input, value) {
	input.value = value;
	if (typeof input.trigger === "function") {
		input.trigger("input");
		return;
	}
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function narrow(items, query) {
	const q = String(query || "").toLowerCase();
	return items
		.filter((item) => suggestionText(item).toLowerCase().includes(q))
		.slice(0, SUGGEST_CAP);
}

const FolderSuggest = AbstractInputSuggest
	? class extends AbstractInputSuggest {
			constructor(app, inputEl, onPicked) {
				super(app, inputEl);
				this.inputEl = inputEl;
				this.onPicked = onPicked;
			}

			getSuggestions(query) {
				const folders = folderList(this.app).filter((folder) => folderPath(folder));
				return narrow(folders.map((folder) => folder.path), query);
			}

			renderSuggestion(path, el) {
				el.setText(path);
			}

			selectSuggestion(path) {
				commitInput(this.inputEl, path);
				if (this.onPicked) {
					this.onPicked(path);
				}
				this.close();
			}
		}
	: null;

const ImageSuggest = AbstractInputSuggest
	? class extends AbstractInputSuggest {
			constructor(app, inputEl, getFolder, onPicked) {
				super(app, inputEl);
				this.inputEl = inputEl;
				this.getFolder = getFolder;
				this.onPicked = onPicked;
			}

			getSuggestions(query) {
				const names = imageFiles(this.app, this.getFolder()).map((file) => file.name);
				return narrow(names, query);
			}

			renderSuggestion(name, el) {
				el.setText(name);
			}

			selectSuggestion(name) {
				commitInput(this.inputEl, name);
				if (this.onPicked) {
					this.onPicked(name);
				}
				this.close();
			}
		}
	: null;

const TargetSuggest = AbstractInputSuggest
	? class extends AbstractInputSuggest {
			constructor(app, inputEl, getKind, onPicked) {
				super(app, inputEl);
				this.inputEl = inputEl;
				this.getKind = getKind;
				this.onPicked = onPicked;
			}

			getSuggestions(query) {
				const kind = this.getKind();
				let items = commandItems(this.app);
				if (kind === "note") {
					items = notePaths(this.app);
				} else if (kind === "folder") {
					items = folderList(this.app)
						.map((folder) => folderPath(folder))
						.filter(Boolean);
				}
				return narrow(items, query);
			}

			renderSuggestion(value, el) {
				el.setText(suggestionText(value));
			}

			selectSuggestion(value) {
				const picked = typeof value === "string" ? value : value.id;
				commitInput(this.inputEl, picked);
				if (this.onPicked) {
					this.onPicked(picked);
				}
				this.close();
			}
		}
	: null;

const ImagePickModal = FuzzySuggestModal
	? class extends FuzzySuggestModal {
			constructor(app, folder, onChoose) {
				super(app);
				this.folder = folder;
				this.onChoose = onChoose;
				this.setPlaceholder("Painting file");
			}

			getItems() {
				return imageFiles(this.app, this.folder);
			}

			getItemText(file) {
				return file.name;
			}

			onChooseItem(file) {
				this.onChoose(file.name);
			}
		}
	: null;

const COLUMN_RULE =
	'<svg viewBox="0 0 140 14" aria-hidden="true"><polygon points="0,7 8,6.2 58,5.4 58,8.6 8,7.8" fill="currentColor"/><polygon points="140,7 132,6.2 82,5.4 82,8.6 132,7.8" fill="currentColor"/><polygon points="70,1.5 75,7 70,12.5 65,7" fill="currentColor"/></svg>';

function columnLabel(column, text, mark) {
	const label = column.createDiv({ cls: "dishonored-column__label" });
	const icon = label.createSpan({ cls: "dishonored-mark" });
	icon.innerHTML = MARKS[mark];
	label.createSpan({ text });
	const rule = column.createDiv({ cls: "dishonored-rule" });
	rule.innerHTML = COLUMN_RULE;
}

const MENU_ORDER = ["heart", "map", "journal", "mark", "ledger", "contract"];

const COMMAND_FALLBACKS = {
	"switcher:open": ["switcher:open"],
	"graph:open": ["graph:open"],
	"daily-notes:goto-today": ["daily-notes:goto-today", "daily-notes"],
	"command-palette:open": ["command-palette:open"],
};

function pressThen(button, action) {
	button.addClass("is-press");
	window.setTimeout(() => {
		button.removeClass("is-press");
		action();
	}, 170);
}

class CampView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "The Camp";
	}

	getIcon() {
		return "shield";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		if (this.clockTimer) {
			window.clearInterval(this.clockTimer);
			this.clockTimer = null;
		}
		this.contentEl.empty();
	}

	render() {
		if (this.clockTimer) {
			window.clearInterval(this.clockTimer);
			this.clockTimer = null;
		}
		const root = this.contentEl;
		root.empty();
		root.addClass("dishonored-camp-root");
		const frame = root.createDiv({ cls: "dishonored-frame" });
		frame.createDiv({ cls: "dishonored-art" });
		frame.createDiv({
			cls: "dishonored-haze",
			attr: { "aria-hidden": "true" },
		});

		const banner = frame.createDiv({ cls: "dishonored-banner" });
		const when = new Date().toLocaleDateString(undefined, {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
		const date = banner.createDiv({ cls: "dishonored-date" });
		date.setText(`${this.app.vault.getName()}  /  ${when}`);
		const clock = banner.createDiv({ cls: "dishonored-clock" });
		const tick = () => {
			clock.setText(
				new Date().toLocaleTimeString(undefined, {
					hour: "numeric",
					minute: "2-digit",
				})
			);
		};
		tick();
		this.clockTimer = window.setInterval(tick, 1000);
		if (!this.clockHooked) {
			this.register(() => {
				if (this.clockTimer) {
					window.clearInterval(this.clockTimer);
				}
			});
			this.clockHooked = true;
		}

		const menu = frame.createEl("nav", {
			cls: "dishonored-ritual",
			attr: { "aria-label": "Camp menu" },
		});
		for (const id of MENU_ORDER) {
			if (!this.plugin.plateShown(id)) {
				continue;
			}
			const plate = PLATES.find((item) => item.id === id);
			const item = menu.createEl("button", {
				cls: "dishonored-word dishonored-ritual__item",
				attr: {
					type: "button",
					"data-plate": plate.id,
				},
			});
			item.setText(this.plugin.plateLabel(plate));
			item.addEventListener("click", () => {
				pressThen(item, () => {
					void this.plugin.runAction(plate.id);
				});
			});
		}

		const lower = frame.createDiv({ cls: "dishonored-lower" });
		const marks = this.plugin.bookmarks();
		if (marks.length > 0) {
			const column = lower.createDiv({ cls: "dishonored-column" });
			columnLabel(column, "Bookmarks", "ribbon");
			const list = column.createEl("ul", {
				cls: "dishonored-bookmarks",
				attr: { "aria-label": "Bookmarks" },
			});
			for (const mark of marks) {
				const item = list.createEl("li");
				const link = item.createEl("button", {
					cls: "dishonored-word dishonored-bookmarks__item",
					attr: { type: "button", "data-plate": "bookmark" },
				});
				link.setText(this.plugin.bookmarkLabel(mark));
				link.addEventListener("click", () => {
					pressThen(link, () => {
						void this.plugin.openBookmark(mark);
					});
				});
			}
		}

		const recentColumn = lower.createDiv({ cls: "dishonored-column" });
		columnLabel(recentColumn, "Recent", "page");
		const recent = recentColumn.createEl("ul", {
			cls: "dishonored-recent",
			attr: { "aria-label": "Recent notes" },
		});
		const files = this.plugin.recentNotes();
		if (files.length === 0) {
			const empty = recent.createEl("li", { cls: "dishonored-recent__empty" });
			empty.setText("No notes yet");
		} else {
			for (const file of files) {
				const item = recent.createEl("li");
				const link = item.createEl("button", {
					cls: "dishonored-word dishonored-recent__note",
					attr: { type: "button", "data-plate": "recent" },
				});
				link.setText(file.basename);
				link.addEventListener("click", () => {
					pressThen(link, () => {
						void this.leaf.openFile(file);
					});
				});
			}
		}
	}
}

class CampSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display() {
		await this.plugin.loadStyleData();
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Dishonored - Dunwall" });

		this.heading(containerEl, "Colors");
		this.colorRow(containerEl, "Bone", "Body text.", "dishonored-bone", "#e6d9c6");
		this.colorRow(
			containerEl,
			"Brass",
			"Second-level headings and the status rail.",
			"dishonored-brass",
			"#a68448"
		);
		this.colorRow(
			containerEl,
			"Amber",
			"Third-level headings and links.",
			"dishonored-amber",
			"#e0a04a"
		);
		this.colorRow(
			containerEl,
			"Ink",
			"The dark ground behind the workspace.",
			"dishonored-ink",
			"#101614"
		);

		this.heading(containerEl, "Painting");
		let folderInput = null;
		const folderRow = new Setting(containerEl)
			.setName("Painting folder")
			.setDesc(
				"Vault folder that holds the picture. Leave blank for the vault root. Example, Wallpapers."
			)
			.addText((text) => {
				folderInput = text.inputEl;
				text
					.setPlaceholder("Wallpapers")
					.setValue(this.plugin.styleValue("dishonored-camp-folder"))
					.onChange(async (value) => {
						await this.plugin.persistStyle("dishonored-camp-folder", value.trim());
					});
				this.plugin.attachFolder(text.inputEl);
			});
		folderRow.settingEl.dataset.id = "dishonored-camp-folder";

		let fileInput = null;
		const fileRow = new Setting(containerEl)
			.setName("Painting file")
			.setDesc(
				"File name inside that folder, such as night.jpg."
			)
			.addText((text) => {
				fileInput = text.inputEl;
				text
					.setPlaceholder("night.jpg")
					.setValue(this.plugin.styleValue("dishonored-camp-file"))
					.onChange(async (value) => {
						await this.plugin.persistStyle("dishonored-camp-file", value.trim());
					});
				this.plugin.attachImage(text.inputEl, () =>
					folderInput ? folderInput.value : this.plugin.styleValue("dishonored-camp-folder")
				);
			})
			.addButton((button) => {
				button.setButtonText("Select").onClick(() => {
					if (!ImagePickModal) {
						return;
					}
					const folder = folderInput
						? folderInput.value
						: this.plugin.styleValue("dishonored-camp-folder");
					new ImagePickModal(this.app, folder, (name) => {
						if (fileInput) {
							commitInput(fileInput, name);
						}
					}).open();
				});
			});
		fileRow.settingEl.dataset.id = "dishonored-camp-file";

		this.sliderRow(
			containerEl,
			"Painting opacity",
			"How solid the camp picture is. Lower it to read the words, then bring it back.",
			"dishonored-camp-opacity",
			0.2,
			1,
			0.01,
			0.8
		);

		this.heading(containerEl, "Camp buttons");
		for (const plate of PLATES) {
			this.toggleRow(
				containerEl,
				`Show ${plate.name}`,
				"Turn this off to hide the word. The others close the gap, and turning it on puts it back in its place.",
				`dishonored-${plate.id}-show`,
				this.plugin.plateShown(plate.id)
			);
			this.textRow(
				containerEl,
				`${plate.name} label`,
				"The word on the painting. The action stays the same.",
				`dishonored-${plate.id}-label`,
				this.plugin.styleValue(`dishonored-${plate.id}-label`)
			);
			const typeKey = `dishonored-${plate.id}-type`;
			const targetKey = `dishonored-${plate.id}-target`;
			const shown = this.plugin.actionFor(plate.id);
			let targetInput = null;
			const typeRow = new Setting(containerEl)
				.setName(`${plate.name} opens`)
				.addDropdown((dropdown) => {
					dropdown
						.addOption("note", "note")
						.addOption("folder", "folder")
						.addOption("command", "command")
						.setValue(shown.type || "note")
						.onChange(async (value) => {
							await this.plugin.persistStyle(typeKey, value);
							const typed = targetInput ? targetInput.value.trim() : "";
							await this.plugin.persistStyle(targetKey, typed);
						});
				});
			typeRow.settingEl.dataset.id = typeKey;
			const targetRow = new Setting(containerEl)
				.setName(`${plate.name} target`)
				.setDesc(ACTION_HINTS[plate.id])
				.addText((text) => {
					targetInput = text.inputEl;
					text
						.setPlaceholder(shown.target ? shown.target : "No destination")
						.setValue(shown.target || "")
						.onChange(async (value) => {
							await this.plugin.persistStyle(targetKey, value.trim());
						});
					this.plugin.attachTarget(text.inputEl, () => {
						const select = typeRow.settingEl.querySelector("select");
						return select && select.value ? select.value : shown.type || "note";
					}, targetKey);
				});
			targetRow.settingEl.dataset.id = targetKey;
		}

		this.toggleRow(
			containerEl,
			"Painting behind notes",
			"A faint copy of that painting along the bottom of a note, with a soft fade toward the top.",
			"dishonored-note-wash",
			this.plugin.styleData["dishonored-dunwall@@dishonored-note-wash"] !== false
		);
		this.sliderRow(
			containerEl,
			"Note painting strength",
			"How visible the painting is behind a note. One tenth is the quiet default.",
			"dishonored-wash-opacity",
			0,
			0.4,
			0.01,
			0.1
		);
		this.sliderRow(
			containerEl,
			"Smoke",
			"How thick the fog is across the camp.",
			"dishonored-smoke",
			0,
			0.8,
			0.01,
			0.6
		);
		this.sliderRow(
			containerEl,
			"Smoke speed",
			"How fast the fog crosses the camp. One is the usual pace. Higher is faster.",
			"dishonored-smoke-speed",
			0.25,
			3,
			0.05,
			1
		);
		this.toggleRow(
			containerEl,
			"Still air",
			"On holds the smoke still. Off lets the steam keep moving.",
			"still-air",
			this.plugin.styleData["dishonored-dunwall@@still-air"] === true
		);
	}

	heading(containerEl, name) {
		new Setting(containerEl).setName(name).setHeading();
	}

	colorRow(containerEl, name, desc, key, fallback) {
		const row = new Setting(containerEl).setName(name).setDesc(desc);
		row.settingEl.dataset.id = key;
		const input = row.controlEl.createEl("input", { type: "color" });
		input.value = this.plugin.colorValue(key, fallback);
		input.addEventListener("input", () => {
			document.body.style.setProperty("--" + key, input.value);
		});
		input.addEventListener("change", () => {
			void this.plugin.persistStyle(key, input.value);
		});
	}

	textRow(containerEl, name, desc, key, value) {
		const row = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setValue(value).onChange(async (next) => {
					await this.plugin.persistStyle(key, next);
				});
			});
		row.settingEl.dataset.id = key;
	}

	toggleRow(containerEl, name, desc, key, value) {
		const row = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) => {
				toggle.setValue(value).onChange(async (next) => {
					await this.plugin.persistStyle(key, next);
				});
			});
		row.settingEl.dataset.id = key;
	}

	sliderRow(containerEl, name, desc, key, min, max, step, fallback) {
		const row = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) => {
				slider
					.setLimits(min, max, step)
					.setValue(this.plugin.numberValue(key, fallback))
					.setDynamicTooltip()
					.onChange(async (next) => {
						await this.plugin.persistStyle(key, next);
					});
			});
		row.settingEl.dataset.id = key;
	}
}

module.exports = class DishonoredCampPlugin extends Plugin {
	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CampSettingTab(this.app, this));
		this.registerView(VIEW_TYPE, (leaf) => new CampView(leaf, this));
		this.addCommand({
			id: "open-camp",
			name: "Return to the camp",
			callback: () => {
				void this.openCamp();
			},
		});
		this.styleData = {};
		this.boundInputs = new WeakSet();
		document.body.removeClass("dishonored-trial-type");
		this.startSettingsWatch();
		this.registerDomEvent(document, "focusin", (evt) => {
			this.attachFromEvent(evt.target);
		});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.onLayout();
			})
		);
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				void this.refreshStyle();
			})
		);
		this.app.workspace.onLayoutReady(() => {
			this.onLayout();
			void this.refreshStyle();
		});
	}

	onunload() {
		if (this.settingsObserver) {
			this.settingsObserver.disconnect();
			this.settingsObserver = null;
		}
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async loadSettings() {
		const stored = (await this.loadData()) || {};
		this.settings = {
			actions: {},
		};
		for (const plate of PLATES) {
			const base = DEFAULT_SETTINGS.actions[plate.id];
			const saved =
				stored.actions && stored.actions[plate.id]
					? stored.actions[plate.id]
					: {};
			this.settings.actions[plate.id] = Object.assign({}, base, saved);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refreshStyle() {
		await this.loadStyleData();
		await this.migrateNoteDefaults();
		this.applyStoredVisuals();
		this.applyNoteWash();
		this.applyCampImage();
		this.rebuildCamps();
	}

	rebuildCamps() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view && typeof leaf.view.render === "function") {
				leaf.view.render();
			}
		}
	}

	async loadStyleData() {
		try {
			const raw = await this.app.vault.adapter.read(
				".obsidian/plugins/obsidian-style-settings/data.json"
			);
			this.styleData = JSON.parse(raw) || {};
		} catch (error) {
			this.styleData = {};
		}
	}

	styleValue(key) {
		const value = this.styleData["dishonored-dunwall@@" + key];
		if (typeof value !== "string") {
			return "";
		}
		return value.trim().replace(/^["']|["']$/g, "");
	}

	colorValue(key, fallback) {
		const value = this.styleValue(key);
		return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
	}

	numberValue(key, fallback) {
		const raw = this.styleData["dishonored-dunwall@@" + key];
		const value = typeof raw === "number" ? raw : parseFloat(raw);
		return Number.isFinite(value) ? value : fallback;
	}

	choiceValue(key, fallback) {
		const value = this.styleValue(key);
		return value === "note" || value === "folder" || value === "command" ? value : fallback;
	}

	applyStoredVisuals() {
		const prefix = "dishonored-dunwall@@";
		for (const full of Object.keys(this.styleData)) {
			if (full.startsWith(prefix)) {
				this.applyVisual(full.slice(prefix.length), this.styleData[full]);
			}
		}
	}

	applyVisual(key, value) {
		if (
			key === "dishonored-bone" ||
			key === "dishonored-brass" ||
			key === "dishonored-amber" ||
			key === "dishonored-ink" ||
			key === "dishonored-smoke" ||
			key === "dishonored-smoke-speed" ||
			key === "dishonored-wash-opacity" ||
			key === "dishonored-camp-opacity"
		) {
			const css = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : value;
			document.body.style.setProperty("--" + key, String(css));
		}
		if (key === "still-air") {
			document.body.toggleClass("still-air", value === true);
		}
	}

	needsRebuild(key) {
		return key.endsWith("-show") || key.endsWith("-label");
	}

	plateShown(id) {
		return this.styleData[`dishonored-dunwall@@dishonored-${id}-show`] !== false;
	}

	plateLabel(plate) {
		const label = this.styleValue(`dishonored-${plate.id}-label`);
		return label || plate.name;
	}

	attachMade(input, factory) {
		if (!AbstractInputSuggest || !input || this.boundInputs.has(input)) {
			return;
		}
		try {
			const made = factory();
			if (made) {
				this.boundInputs.add(input);
			}
		} catch (error) {
			// Leave the field unbound so a later scan can try again.
		}
	}

	attachFolder(input) {
		this.attachMade(input, () => {
			if (!FolderSuggest) {
				return null;
			}
			return new FolderSuggest(this.app, input, (value) => {
				this.rememberStyle("dishonored-camp-folder", value);
			});
		});
	}

	attachImage(input, getFolder) {
		this.attachMade(input, () => {
			if (!ImageSuggest) {
				return null;
			}
			return new ImageSuggest(this.app, input, getFolder, (value) => {
				this.rememberStyle("dishonored-camp-file", value);
			});
		});
	}

	attachTarget(input, getKind, styleKey) {
		this.attachMade(input, () => {
			if (!TargetSuggest) {
				return null;
			}
			return new TargetSuggest(this.app, input, getKind, (value) => {
				if (styleKey) {
					this.rememberStyle(styleKey, value);
				}
			});
		});
	}

	rememberStyle(key, value) {
		window.setTimeout(() => {
			void this.ensureStyle(key, value);
		}, 120);
	}

	async ensureStyle(key, value) {
		await this.loadStyleData();
		if (this.styleData["dishonored-dunwall@@" + key] === value) {
			this.applyCampImage();
			this.rebuildCamps();
			return;
		}
		await this.persistStyle(key, value);
	}

	async persistStyle(key, value) {
		const full = "dishonored-dunwall@@" + key;
		const path = ".obsidian/plugins/obsidian-style-settings/data.json";
		let data = {};
		try {
			data = JSON.parse(await this.app.vault.adapter.read(path)) || {};
		} catch (error) {
			data = {};
		}
		data[full] = value;
		try {
			await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
		} catch (error) {
			data = Object.assign({}, this.styleData, { [full]: value });
		}
		this.styleData = data;
		this.applyStoredVisuals();
		this.applyNoteWash();
		if (key === "dishonored-camp-folder" || key === "dishonored-camp-file") {
			this.applyCampImage();
		}
		if (this.needsRebuild(key)) {
			this.rebuildCamps();
		}
	}

	styleKeyFor(name) {
		if (name === "Painting folder") {
			return "dishonored-camp-folder";
		}
		if (name === "Painting file") {
			return "dishonored-camp-file";
		}
		const plate = PLATES.find((item) => name === `${item.name} target`);
		if (plate) {
			return `dishonored-${plate.id}-target`;
		}
		return "";
	}

	async migrateNoteDefaults() {
		const path = ".obsidian/plugins/obsidian-style-settings/data.json";
		let data;
		try {
			data = JSON.parse(await this.app.vault.adapter.read(path)) || {};
		} catch (error) {
			return;
		}
		let changed = false;
		for (const id of MENU_ORDER) {
			const typeKey = `dishonored-dunwall@@dishonored-${id}-type`;
			const rawTarget = data[`dishonored-dunwall@@dishonored-${id}-target`];
			const target =
				typeof rawTarget === "string"
					? rawTarget.trim().replace(/^["']|["']$/g, "")
					: "";
			if (data[typeKey] === "command" && !target) {
				data[typeKey] = "note";
				changed = true;
			}
		}
		if (!changed) {
			return;
		}
		try {
			await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
		} catch (error) {
			return;
		}
		this.styleData = data;
	}

	startSettingsWatch() {
		if (this.settingsObserver) {
			return;
		}
		this.settingsHost = document;
		this.settingsObserver = new MutationObserver(() => {
			this.scheduleScan();
		});
		this.settingsObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
		this.scanSettings(document);
	}

	attachFromEvent(target) {
		if (!target || !target.closest || target.tagName !== "INPUT") {
			return;
		}
		if (target.type && target.type !== "text") {
			return;
		}
		const item = target.closest(".setting-item");
		if (!item) {
			return;
		}
		const nameEl = item.querySelector(".setting-item-name");
		const name = nameEl ? nameEl.textContent.trim() : "";
		this.attachNamed(target, name, item);
	}

	scheduleScan() {
		if (this.scanFrame) {
			return;
		}
		this.scanFrame = window.requestAnimationFrame(() => {
			this.scanFrame = 0;
			if (this.settingsHost) {
				this.scanSettings(this.settingsHost);
			}
		});
	}

	attachNamed(input, name, item) {
		const id = (item && item.dataset && item.dataset.id) || "";
		if (id === "dishonored-camp-folder" || name === "Painting folder") {
			this.attachFolder(input);
			return;
		}
		if (id === "dishonored-camp-file" || name === "Painting file") {
			this.attachImage(input, () => this.paintingFolderValue());
			return;
		}
		if (/^dishonored-(heart|map|journal|mark|ledger|contract)-target$/.test(id)) {
			this.attachTarget(input, () => this.kindFrom(item), id);
			return;
		}
		const key = this.styleKeyFor(name);
		if (!key || !name.endsWith(" target")) {
			return;
		}
		this.attachTarget(input, () => this.kindFrom(item), key);
	}

	paintingFolderValue() {
		const folderInput =
			this.inputBySettingId("dishonored-camp-folder") || this.namedInput("Painting folder");
		return folderInput ? folderInput.value : this.styleValue("dishonored-camp-folder");
	}

	inputBySettingId(id) {
		const host = this.settingsHost || document;
		const item = host.querySelector(`.setting-item[data-id="${id}"]`);
		if (!item) {
			return null;
		}
		return item.querySelector("input[type='text'], input:not([type])");
	}

	scanSettings(root) {
		const items = root.querySelectorAll(".setting-item");
		for (const item of items) {
			const nameEl = item.querySelector(".setting-item-name");
			const name = nameEl ? nameEl.textContent.trim() : "";
			const input = item.querySelector("input");
			if (!input || (input.type && input.type !== "text")) {
				continue;
			}
			this.attachNamed(input, name, item);
		}
	}

	kindFrom(item) {
		const select = item.querySelector("select");
		if (select && select.value) {
			return select.value;
		}
		const prev = item.previousElementSibling;
		const prevSelect = prev && prev.querySelector ? prev.querySelector("select") : null;
		if (prevSelect && prevSelect.value) {
			return prevSelect.value;
		}
		return "note";
	}

	namedInput(label) {
		const host = this.settingsHost || document;
		const items = host.querySelectorAll(".setting-item");
		for (const item of items) {
			const name = item.querySelector(".setting-item-name");
			if (name && name.textContent.trim() === label) {
				return item.querySelector("input");
			}
		}
		return null;
	}

	applyNoteWash() {
		const show = this.styleData["dishonored-dunwall@@dishonored-note-wash"] !== false;
		document.body.toggleClass("dishonored-note-wash", show);
	}

	applyCampImage() {
		const folder = this.styleValue("dishonored-camp-folder").replace(/\\/g, "/");
		const file = this.styleValue("dishonored-camp-file").replace(/\\/g, "/");
		if (!file) {
			document.body.style.removeProperty("--dishonored-camp-image");
			return;
		}
		const folderPath = folder.replace(/^\/+|\/+$/g, "");
		const filePath = file.replace(/^\/+/, "");
		const path = folderPath ? `${folderPath}/${filePath}` : filePath;
		const found = this.app.vault.getAbstractFileByPath(path);
		if (!(found instanceof TFile)) {
			document.body.style.removeProperty("--dishonored-camp-image");
			return;
		}
		const resource = this.app.vault.adapter.getResourcePath(found.path);
		document.body.style.setProperty(
			"--dishonored-camp-image",
			`url("${resource.replace(/"/g, "%22")}")`
		);
	}

	actionFor(id) {
		const base = this.settings.actions[id] || { type: "command", target: "" };
		const target = this.styleValue(`dishonored-${id}-target`);
		if (!target) {
			return base;
		}
		const chosen = this.styleValue(`dishonored-${id}-type`);
		const type =
			chosen === "note" || chosen === "folder" || chosen === "command"
				? chosen
				: base.type;
		return { type, target };
	}

	recentNotes() {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => {
				const path = file.path;
				return !path.startsWith(".") && !path.includes("/.");
			})
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 5);
	}

	bookmarks() {
		const internal = this.app.internalPlugins;
		let entry = null;
		if (internal && typeof internal.getPluginById === "function") {
			entry = internal.getPluginById("bookmarks");
		}
		if (!entry && internal && internal.plugins) {
			entry = internal.plugins.bookmarks;
		}
		if (!entry || !entry.enabled || !entry.instance) {
			return [];
		}
		const list = entry.instance.items;
		if (!Array.isArray(list)) {
			return [];
		}
		const found = [];
		for (const item of list) {
			if (found.length >= 5) {
				break;
			}
			if (!item || !item.path) {
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (item.type === "file" && file instanceof TFile) {
				found.push(item);
			} else if (item.type === "folder" && file instanceof TFolder) {
				found.push(item);
			}
		}
		return found;
	}

	bookmarkLabel(item) {
		if (typeof item.title === "string" && item.title.trim()) {
			return item.title.trim();
		}
		const path = item.path || "";
		const name = path.split("/").pop() || path;
		return name.replace(/\.md$/i, "");
	}

	async openBookmark(item) {
		if (item.type === "folder") {
			await this.openFolder(item.path);
			return;
		}
		if (item.type === "file") {
			await this.openNote(item.path);
		}
	}

	onLayout() {
		if (this.opening) {
			return;
		}
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf || leaf.getViewState().type !== "empty") {
			return;
		}
		this.opening = true;
		leaf
			.setViewState({ type: VIEW_TYPE, active: true })
			.finally(() => {
				this.opening = false;
			});
	}

	async openCamp() {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	async runAction(id) {
		await this.loadStyleData();
		const action = this.actionFor(id);
		if (!action || !action.target) {
			return;
		}
		if (action.type === "command") {
			if (!this.runCommand(action.target)) {
				new Notice("That command is not available.");
			}
			return;
		}
		if (action.type === "folder") {
			await this.openFolder(action.target);
			return;
		}
		if (action.type === "note") {
			await this.openNote(action.target);
		}
	}

	runCommand(id) {
		const list = [id].concat(COMMAND_FALLBACKS[id] || []);
		const seen = new Set();
		for (const command of list) {
			if (seen.has(command)) {
				continue;
			}
			seen.add(command);
			if (this.app.commands.executeCommandById(command)) {
				return true;
			}
		}
		return false;
	}

	async openFolder(path) {
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) {
			new Notice("That folder is not in the vault.");
			return;
		}
		const left = this.app.workspace.leftSplit;
		if (left && left.collapsed && typeof left.expand === "function") {
			left.expand();
		}
		const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
		const view = leaf && leaf.view;
		if (view && typeof view.revealInFolder === "function") {
			view.revealInFolder(folder);
			return;
		}
		new Notice("The file list is closed.");
	}

	async openNote(path) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("That note is not in the vault.");
			return;
		}
		const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
};
