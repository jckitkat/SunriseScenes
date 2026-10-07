-- Made-up stand-in for a generated mission module.
local M = {}
M.states = {
    STATE_80CC0003_0005_0000_80CC00A1 = { id = "state/80cc0003/0005/0000/80cc00a1", region_index = 40 },
    STATE_80CC0003_0010_0000_80CC00A2 = { id = "state/80cc0003/0010/0000/80cc00a2", region_index = 128 },
}
M.Slot = {
    M_PUBLIC_EVENT_SENSOR_80CC0010 = "slot/80cc1000/0000/0000/71",
    OBJ_PIKE_PATH = "slot/80cc1001/0000/0000/3",
    DUNGEON_CHEST = "slot/80cc1002/0000/0000/4",
    FALLEN_AMBIENT_0 = "slot/80cc1003/0000/0000/1",
    FALLEN_AMBIENT_1 = "slot/80cc1003/0000/0001/1",
    PSION_SQUAD_A = "slot/80cc1003/0000/0002/1",
    PSION_SQUAD_B = "slot/80cc1003/0000/0003/1",
    CABAL_GUARDS_A = "slot/80cc1003/0000/0004/1",
    SQ_OLD_BOSS = "slot/80cc1003/0000/0005/1",
}
M.Squad = {
    FALLEN_AMBIENT_0 = "squad/80cc1003/0000",
    FALLEN_AMBIENT_1 = "squad/80cc1003/0001",
    PSION_SQUAD_A = "squad/80cc1003/0002",
    PSION_SQUAD_B = "squad/80cc1003/0003",
    CABAL_GUARDS_A = "squad/80cc1003/0004",
    SQ_OLD_BOSS = "squad/80cc1003/0005",
}
return M
