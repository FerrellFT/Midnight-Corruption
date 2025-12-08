// scripts/midnight-corruption.js

const MC = {
  MODULE_ID: "midnight-corruption",
  LEVEL_DIE_MAP: {
    0: "1d4",
    1: "1d6",
    2: "1d8",
    3: "1d10",
    4: "1d20"
  }
};

class MidnightCorruption {
  // Helper: get current state from actor flags or initialize defaults
  static getActorState(actor) {
    const stored = actor.getFlag(MC.MODULE_ID, "state") || {};
    let level = Number(stored.level ?? 0);
    if (Number.isNaN(level)) level = 0;
    const die = stored.die || MC.LEVEL_DIE_MAP[level] || null;
    const minorMutations = stored.minorMutations || [];
    const majorMutations = stored.majorMutations || [];
    return { level, die, minorMutations, majorMutations };
  }

  static async setActorState(actor, state) {
    return actor.setFlag(MC.MODULE_ID, "state", state);
  }

  // Upgrade level & die when a corruption step occurs (roll of 1)
  static upgradeLevel(state) {
    if (state.level >= 5) return state; // already fully warped
    let newLevel = state.level + 1;
    let newDie = newLevel < 5 ? MC.LEVEL_DIE_MAP[newLevel] : null;
    return {
      ...state,
      level: newLevel,
      die: newDie
    };
  }

  // Main manual trigger: roll corruption die for an actor
  static async rollForActor(actor, { reason = "", notes = "" } = {}) {
    if (!actor) {
      ui.notifications.warn("Midnight Corruption: No actor provided.");
      return;
    }

    let state = MidnightCorruption.getActorState(actor);

    if (state.level >= 5 || !state.die) {
      ui.notifications.info(`${actor.name} has already succumbed to Midnight Corruption.`);
      return;
    }

    const roll = await (new Roll(state.die)).roll({ async: true });

    // Whisper result to all GMs
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    const parts = [];

    parts.push(`<strong>Midnight Corruption – ${actor.name}</strong>`);
    if (reason) parts.push(`<em>Reason:</em> ${reason}`);
    if (notes) parts.push(`<em>Notes:</em> ${notes}`);
    parts.push(`<em>Current Corruption Die:</em> ${state.die}`);
    parts.push(`<em>Roll Result:</em> ${roll.total}`);

    let mutationPrompt = "";
    let levelChanged = false;
    let oldLevel = state.level;

    if (roll.total === 1) {
      state = MidnightCorruption.upgradeLevel(state);
      levelChanged = state.level !== oldLevel;

      if (levelChanged) {
        parts.push(`<hr/><em>Corruption Level increased to:</em> ${state.level}`);
        parts.push(`<em>New Corruption Die:</em> ${state.die ?? "—"}`);

        if (state.level === 2) {
          mutationPrompt = "Minor mutation triggered (cosmetic).";
        } else if (state.level === 3) {
          mutationPrompt = "Major mutation + mental quirk triggered.";
        } else if (state.level === 4) {
          mutationPrompt = "Additional major mutation; mental state worsens.";
        } else if (state.level === 5) {
          mutationPrompt = "Subject succumbs to Midnight Corruption and becomes Warped (dead).";
        }

        if (mutationPrompt) {
          parts.push(`<strong>${mutationPrompt}</strong>`);
        }

        await MidnightCorruption.setActorState(actor, state);
      }
    }

    // Render roll in the chat card
    const content = `
      <div class="mc-chat-card">
        ${parts.join("<br/>")}
        <hr/>
        <div>${await roll.render()}</div>
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: { alias: "Midnight Corruption" },
      whisper: gmIds
    });

    // Re-render tracker if it's open
    if (game.midnightCorruption?.tracker?.rendered) {
      game.midnightCorruption.tracker.render(false);
    }

    return { roll, state };
  }

  // Manually adjust level (for rare cures / retcons)
  static async adjustLevel(actor, delta) {
    if (!actor) return;
    let state = MidnightCorruption.getActorState(actor);
    let newLevel = Math.clamped(state.level + delta, 0, 5);
    state.level = newLevel;
    state.die = newLevel < 5 ? MC.LEVEL_DIE_MAP[newLevel] : null;
    await MidnightCorruption.setActorState(actor, state);

    if (game.midnightCorruption?.tracker?.rendered) {
      game.midnightCorruption.tracker.render(false);
    }
  }

  // Add a minor cosmetic mutation (freeform text)
  static async addMinorMutation(actor, text) {
    if (!actor || !text?.trim()) return;
    const state = MidnightCorruption.getActorState(actor);
    state.minorMutations.push(text.trim());
    await MidnightCorruption.setActorState(actor, state);
  }

  // Add a major mutation from skeleton table
  static async addMajorMutationFromTable(actor) {
    if (!actor) return;

    const roll = await (new Roll("1d12")).roll({ async: true });
    const entry = MidnightCorruption.majorMutationEntry(roll.total);

    const content = `
      <div class="mc-mutation-dialog">
        <p><strong>Major Mutation – ${actor.name}</strong></p>
        <p><em>Roll:</em> d12 → ${roll.total}</p>
        <p><strong>${entry.name}</strong></p>
        <p>${entry.description}</p>
        <label>GM Notes (mechanical effects, etc.):</label>
        <textarea name="notes" rows="4" style="width:100%;"></textarea>
      </div>
    `;

    return new Promise(resolve => {
      new Dialog({
        title: "Major Mutation",
        content,
        buttons: {
          save: {
            label: "Save Mutation",
            callback: async html => {
              const notes = html.find('textarea[name="notes"]').val();
              const state = MidnightCorruption.getActorState(actor);
              state.majorMutations.push({
                id: roll.total,
                name: entry.name,
                notes: notes || ""
              });
              await MidnightCorruption.setActorState(actor, state);

              if (game.midnightCorruption?.tracker?.rendered) {
                game.midnightCorruption.tracker.render(false);
              }

              resolve(state);
            }
          },
          cancel: {
            label: "Cancel",
            callback: () => resolve(null)
          }
        },
        default: "save"
      }).render(true);
    });
  }

  // Skeleton major mutation table
  static majorMutationEntry(id) {
    const table = {
      1: {
        name: "Crystalline Armor",
        description: "Parts of the body are encrusted in violet crystal, hardening the flesh."
      },
      2: {
        name: "Nebula Lash",
        description: "A limb or growth becomes a lash-like appendage, suggestive of unnatural reach."
      },
      3: {
        name: "Extra Eyes / Sensory Nodes",
        description: "Additional eyes or crystalline sensory nodes emerge along the skin."
      },
      4: {
        name: "Warped Locomotion",
        description: "The way the body moves changes: reversed joints, extra limbs, or partial hovering."
      },
      5: {
        name: "Nebula Pulse",
        description: "The body emits faint, periodic pulses of violet energy that disturb the air."
      },
      6: {
        name: "Voracious Maw",
        description: "A secondary mouth, mandibles, or maw opens where there was none before."
      },
      7: {
        name: "Echoed Voice",
        description: "The voice fractures into layered tones, echoing with subtle Nebula resonance."
      },
      8: {
        name: "Phase-Shifted Flesh",
        description: "Portions of the body flicker between solidity and an insubstantial state."
      },
      9: {
        name: "Living Crystal Growth",
        description: "Clusters of Starshard-like crystals sprout, pulsing as though breathing."
      },
      10: {
        name: "Nebula-Thickened Blood",
        description: "Blood becomes viscous and faintly luminous, resisting normal flow."
      },
      11: {
        name: "Reality Glitch Aura",
        description: "Subtle spatial and visual distortions manifest around the afflicted."
      },
      12: {
        name: "Warped Mind Manifest",
        description: "The mind’s corruption takes on a visible form: third eye, halo, or shifting shadow."
      }
    };
    return table[id] || {
      name: "Indescribable Mutation",
      description: "A mutation beyond easy description manifests upon the subject."
    };
  }

  // Tracker helpers
  static getTrackedActorIds() {
    const ids = game.settings.get(MC.MODULE_ID, "trackedActors") || [];
    return Array.isArray(ids) ? ids : [];
  }

  static async setTrackedActorIds(ids) {
    return game.settings.set(MC.MODULE_ID, "trackedActors", ids);
  }

  static async addTrackedActor(actorId) {
    const ids = MidnightCorruption.getTrackedActorIds();
    if (!ids.includes(actorId)) {
      ids.push(actorId);
      await MidnightCorruption.setTrackedActorIds(ids);
    }
  }

  static async removeTrackedActor(actorId) {
    let ids = MidnightCorruption.getTrackedActorIds();
    ids = ids.filter(id => id !== actorId);
    await MidnightCorruption.setTrackedActorIds(ids);
  }
}

// Simple GM tracker UI
class MidnightCorruptionTracker extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "midnight-corruption-tracker",
      title: "Midnight Corruption",
      template: `modules/${MC.MODULE_ID}/templates/midnight-corruption-tracker.html`,
      width: 420,
      height: "auto",
      resizable: true
    });
  }

  getData(options = {}) {
    const data = super.getData(options);
    const ids = MidnightCorruption.getTrackedActorIds();
    const actors = ids
      .map(id => game.actors.get(id))
      .filter(a => !!a);

    data.actors = actors.map(actor => {
      const state = MidnightCorruption.getActorState(actor);
      return {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        level: state.level,
        die: state.die || "—"
      };
    });

    data.hasActors = data.actors.length > 0;
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.on("click", ".mc-roll", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      MidnightCorruption.rollForActor(actor, { reason: "Manual trigger" });
    });

    html.on("click", ".mc-level-inc", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      MidnightCorruption.adjustLevel(actor, +1);
    });

    html.on("click", ".mc-level-dec", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      MidnightCorruption.adjustLevel(actor, -1);
    });

    html.on("click", ".mc-remove", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      await MidnightCorruption.removeTrackedActor(actorId);
      this.render(false);
    });

    html.on("click", "#mc-add-actor", async ev => {
      ev.preventDefault();
      this._showAddActorDialog();
    });

    html.on("click", ".mc-add-minor", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      this._showAddMinorDialog(actor);
    });

    html.on("click", ".mc-add-major", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      MidnightCorruption.addMajorMutationFromTable(actor);
    });
  }

  _showAddActorDialog() {
    const options = game.actors.contents
      .filter(a => a.hasPlayerOwner || a.type === "character")
      .map(a => `<option value="${a.id}">${a.name}</option>`)
      .join("");

    const content = `
      <div>
        <label>Select actor to track:</label>
        <select name="actor-id" style="width:100%;">
          ${options}
        </select>
      </div>
    `;

    new Dialog({
      title: "Add Tracked Actor",
      content,
      buttons: {
        add: {
          label: "Add",
          callback: async html => {
            const actorId = html.find('select[name="actor-id"]').val();
            if (actorId) {
              await MidnightCorruption.addTrackedActor(actorId);
              this.render(false);
            }
          }
        },
        cancel: {
          label: "Cancel"
        }
      },
      default: "add"
    }).render(true);
  }

  _showAddMinorDialog(actor) {
    const content = `
      <div>
        <p>Add a cosmetic (minor) mutation for <strong>${actor.name}</strong>:</p>
        <textarea name="minor-text" rows="4" style="width:100%;"></textarea>
      </div>
    `;

    new Dialog({
      title: "Add Minor Mutation",
      content,
      buttons: {
        save: {
          label: "Save",
          callback: async html => {
            const text = html.find('textarea[name="minor-text"]').val();
            await MidnightCorruption.addMinorMutation(actor, text);
          }
        },
        cancel: {
          label: "Cancel"
        }
      },
      default: "save"
    }).render(true);
  }
}

// Register module settings & expose API
Hooks.once("init", () => {
  console.log("Midnight Corruption | Initializing");

  game.settings.register(MC.MODULE_ID, "trackedActors", {
    name: "Tracked Actors",
    hint: "Internal storage for which actors are tracked by the Midnight Corruption panel.",
    scope: "world",
    config: false,
    default: [],
    type: Array
  });

  game.settings.register(MC.MODULE_ID, "autoOpenTracker", {
    name: "Auto-open Corruption Tracker",
    hint: "Automatically open the Midnight Corruption tracker for GMs on world load.",
    scope: "client",
    config: true,
    default: true,
    type: Boolean
  });
});

Hooks.once("ready", () => {
  // Only GMs need the tracker & API
  if (!game.user.isGM) return;

  const tracker = new MidnightCorruptionTracker();

  game.midnightCorruption = {
    tracker,
    openTracker: () => tracker.render(true),
    rollForActor: MidnightCorruption.rollForActor
  };

  if (game.settings.get(MC.MODULE_ID, "autoOpenTracker")) {
    tracker.render(true);
  }

  console.log("Midnight Corruption | Ready");
});

Hooks.on("chatMessage", (chatLog, messageText, chatData) => {
  const msg = messageText.trim();
  if (msg === "/mctracker") {
    if (!game.user.isGM) {
      ui.notifications.warn("Only GMs can open the Midnight Corruption tracker.");
    } else {
      game.midnightCorruption?.openTracker();
    }
    // Prevent this from creating an actual chat message
    return false;
  }
});
