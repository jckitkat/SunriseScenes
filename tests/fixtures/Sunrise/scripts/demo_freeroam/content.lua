-- Generated from installed mission data. Do not edit.
-- Zones are authored state rows; population and event sites come from the slice sets.
return function(mission, freeroam)
    local unit = freeroam.unit
    return {
        {
            state = mission.states.STATE_80CC0003_0005_0000_80CC00A1,
            region = 40,
            patrol = {
                unit(mission.Squad.FALLEN_AMBIENT_0, mission.Slot.FALLEN_AMBIENT_0),
                unit(mission.Squad.FALLEN_AMBIENT_1, mission.Slot.FALLEN_AMBIENT_1),
            },
            events = {
                {
                    sensor = mission.Slot.M_PUBLIC_EVENT_SENSOR_80CC0010,
                    objective = mission.Slot.OBJ_PIKE_PATH,
                    squads = {
                        unit(mission.Squad.PSION_SQUAD_A, mission.Slot.PSION_SQUAD_A),
                        unit(mission.Squad.PSION_SQUAD_B, mission.Slot.PSION_SQUAD_B),
                    },
                    chest = {
                    },
                },
            },
        },
        {
            state = mission.states.STATE_80CC0003_0010_0000_80CC00A2,
            region = 128,
            -- Lost Sector in bubble 16.
            sector = {
                boss = mission.Slot.SQ_OLD_BOSS,
                squads = {
                    unit(mission.Squad.CABAL_GUARDS_A, mission.Slot.CABAL_GUARDS_A),
                    unit(mission.Squad.SQ_OLD_BOSS, mission.Slot.SQ_OLD_BOSS),
                },
                chest = {
                    mission.Slot.DUNGEON_CHEST,
                },
            },
        },
    }
end
