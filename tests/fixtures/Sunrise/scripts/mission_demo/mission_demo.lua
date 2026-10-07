-- Demo. A made-up campaign script in the style of the Red War drafts, for tests.
-- Leg order: landing -> yard.
local missions = require("missions")
local mission = require(missions.MISSION_DEMO)
local campaign = require("lib.campaign")
local unit, line, move = campaign.unit, campaign.line, campaign.move
local Slot, Squad, Directive = mission.Slot, mission.Squad, mission.Directive
local cue = mission.DialogueCue.M_DIALOG_SENSOR_80AA0001

local greeters = {
    id = "greeters",
    squads = {unit(Squad.SQ_GREETER, Slot.SQ_GREETER)},
}

-- The yard fight starts when the player crosses the gate.
local yard = {
    id = "yard",
    trigger = Slot.PT_GATE,
    after = "reach",
    objective = Slot.OBJ_YARD,
    lines = {line(cue.CUE_4)},
    squads = {
        unit(Squad.SQ_YARD_A, Slot.SQ_YARD_A),
        unit(Squad.SQ_YARD_B, Slot.SQ_YARD_B),
    },
}

return campaign.new{
    key = "demo",
    directive_sensor = Slot.M_DIRECTIVE_SENSOR_80AA0001,
    dialogue_sensor = Slot.M_DIALOG_SENSOR_80AA0001,
    spawn_set = 0x8029E4B4,
    intro = {
        {state = mission.states.STATE_80AA0001_0001_0000_80AA00A1, cinematic = Slot.PF_OPENING_CINEMATIC},
    },
    legs = {
        {id = "landing", state = mission.states.STATE_80AA0001_0002_0000_80AA00A2, arm = {
            Slot.PT_GATE,
        }},
        {id = "yard", state = mission.states.STATE_80AA0001_0003_0000_80AA00A3, arm = {
            Slot.PT_EXIT, Slot.PT_SWITCH_ROOM,
        }},
    },
    steps = {
        -- "Head for the gate."
        {id = "reach", directive = Directive.REACH_THE_GATE, navpoint = Slot.AP_GATE,
            lines = {line(cue.CUE_1), line(cue.CUE_2, Slot.TV_GATE_APPROACH)},
            ends = {trigger = Slot.PT_GATE}},
        {id = "fight", directive = Directive.CLEAR_THE_YARD, barrier = true,
            on_start = function(context)
                move(context, {Slot.D_YARD_LIGHTS}, "power_on")
            end,
            ends = {clear = "yard"}},
        -- The switch opens the way out.
        {id = "switch", directive = Directive.OPEN_THE_WAY_OUT, navpoint = Slot.AP_SWITCH,
            on_start = function(context)
                move(context, {Slot.D_SWITCH_DOOR, Slot.D_SWITCH}, "open")
                context:slot(Slot.MUSIC_SENSOR):set_music_section{section = 3}
            end,
            ends = {interact = Slot.O_SWITCH, trigger = {Slot.PT_SWITCH_ROOM, Slot.PT_EXIT}}},
        {id = "leave", directive = Directive.LEAVE_THE_YARD, revisit = true,
            ends = {trigger = Slot.PT_EXIT, region = "yard"}},
    },
    encounters = {greeters, yard},
}
