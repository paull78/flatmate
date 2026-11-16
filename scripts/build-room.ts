import { buildRoom, describeRooms } from "./src/rooms";

console.log("Flatmate: a room built through the domain API only (no editor, no UI, no server)");
console.table(describeRooms(buildRoom()));
