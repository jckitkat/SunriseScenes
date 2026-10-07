-- Demo destination. A made-up open-world script in the shape of the real ones, for tests.
-- Zones and their content are in content.lua.
local missions = require("missions")
local mission = require(missions.DEMO_FREEROAM)
local freeroam = require("lib.freeroam")
local content = require("demo_freeroam.content")

return freeroam.new{zones = content(mission, freeroam)}
