-- A made-up script written directly against the API, with no lib.campaign. For tests:
-- the canvas cannot draw this, so the app must open it as text.
local missions = require("missions")
local mission = require(missions.MISSION_DEMO)
local Slot = mission.Slot

return {
    on_start = function(context, state)
        context:set_variable("hello", "started")
    end,
    on_event_region_changed = function(context, state, event)
        local seen = state:variable("regions_seen") or 0
        context:set_variable("regions_seen", seen + 1)
        if seen == 0 then
            context:slot(Slot.PT_GATE):fire_trigger()
        end
    end,
}
