/**
 * "Did you know?" items for the top bar. Newman facts come from public sources; portal tips are about this app.
 * WIRING POINT: replace with a source Newman staff can edit (file, Open WebUI knowledge, or core).
 */
export type Fact = { id: string; text: string };

export function getFacts(): Fact[] {
  return [
    { id: "f1", text: "Newman University was founded in 1933 as Sacred Heart Junior College by the Adorers of the Blood of Christ." },
    { id: "f2", text: "The school has been called Newman University since 1998. Before that it was Kansas Newman College." },
    { id: "f3", text: "Newman became coeducational in 1965." },
    { id: "f4", text: "The Newman Jets compete in NCAA Division II." },
    { id: "f5", text: "You can ask Digi to start a room request, then track it on the Bookings page." },
    { id: "f6", text: "Star a worker on the Workers page to keep it one click away." },
    { id: "f7", text: "Your past conversations are saved under History." },
  ];
}
