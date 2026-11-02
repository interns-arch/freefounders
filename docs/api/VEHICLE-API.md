# Kaampilot Vehicle API

A read-only way to get your company's vehicle gate register into another system: Excel, a dashboard, your own software.
It can only read. It cannot add, change or delete anything.

**Base address:** `https://kaampilot.com/tasks/api/visitors/v1`

All times are India time (IST). Times in answers look like `2026-11-02T14:30:00+05:30`.

---

## 1. Get a key

The company's Owner or an Admin makes the key:

1. Sign in to Kaampilot and open **Visitors → Settings**.
2. Scroll to **API access**.
3. Type who the key is for (for example "Senior manager"), optionally a date it should stop working, and press **Make a key**.
4. **Copy the key at once.** It is shown only this one time. Kaampilot keeps only a one-way fingerprint of it, so nobody can
   show it to you again. If it is lost, revoke it and make a new one.

A key looks like this: `kpv_yourcompany_AbCdEf...` (about 50 characters).

Treat the key like a password. It reads every vehicle record of your company, including drivers' mobile numbers and photos.
Do not put it in an email, a chat or a shared file. If it may have leaked, press **Revoke** on the same screen: it stops
working at once.

The **API access** card shows when each key was last used. This is accurate to about a minute.

---

## 2. Send the key with every request

Use either of these two headers:

```
Authorization: Bearer YOUR_API_KEY
X-API-Key: YOUR_API_KEY
```

Never put the key in the address. A key in the address is refused.

Try it (replace `YOUR_API_KEY`):

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/?page_size=5"
```

---

## 3. What you can ask for

Only `GET` works. Anything else answers `405`.

| Address | What it gives |
|---|---|
| `/vehicles/` | All vehicle movements, newest first, one page at a time |
| `/vehicles/<id>/` | One movement |
| `/vehicles/inside/` | Vehicles inside right now, with the count |
| `/vehicles/summary/?from=&to=` | Counts per day and per type, average and longest time inside |
| `/vehicles/<id>/photos/in/` | The photo taken at entry (the image itself) |
| `/vehicles/<id>/photos/out/` | The photo taken at exit (the image itself) |

### Examples

Everything that came in during October:

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/?from=2026-10-01&to=2026-10-31&page_size=200"
```

Trucks still inside:

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/?status=inside&type=truck"
```

Every visit of one vehicle (spaces and dashes in the number do not matter, part of a number works):

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/?vehicle_number=MH12AB"
```

Who is inside now:

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/inside/"
```

Monthly summary:

```
curl -H "Authorization: Bearer YOUR_API_KEY" "https://kaampilot.com/tasks/api/visitors/v1/vehicles/summary/?from=2026-10-01&to=2026-10-31"
```

Save an entry photo to a file:

```
curl -H "Authorization: Bearer YOUR_API_KEY" -o photo.jpg "https://kaampilot.com/tasks/api/visitors/v1/vehicles/123/photos/in/"
```

---

## 4. Filters for `/vehicles/`

All are optional and can be combined.

| Filter | Meaning | Example |
|---|---|---|
| `from` | Came in on or after this date or time | `2026-10-01` or `2026-10-01T09:00:00+05:30` |
| `to` | Came in on or before this date or time. A date alone means the end of that day | `2026-10-31` |
| `status` | `inside`, `out` or `all` (default `all`) | `inside` |
| `vehicle_number` | Part of the number; spaces, dashes and small letters are all fine | `mh12` |
| `type` | `car`, `bike`, `truck`, `tempo` or `other` | `truck` |
| `purpose` | Part of the purpose text, any case | `delivery` |
| `updated_since` | Only records added or changed on or after this date or time (see section 7) | `2026-11-01T00:00:00+05:30` |
| `page` | Page number, from 1 | `2` |
| `page_size` | Rows per page, at most 200 (default 50; a bigger number gives 200) | `200` |

A date or time without an offset is India time. If you write a time with `+05:30` in the address, write the plus sign as
`%2B` where your tool asks for an encoded address.

---

## 5. What comes back

### A list

```json
{
  "count": 412,
  "next": "https://kaampilot.com/tasks/api/visitors/v1/vehicles/?page_size=50&page=2",
  "previous": null,
  "results": [ { "...one record, see below..." } ]
}
```

`count` is the total across all pages. Follow `next` until it is `null`. A page past the end gives empty `results`.

`/vehicles/inside/` has the same shape, with up to 200 rows per page.

### One record

```json
{
  "id": 123,
  "vehicle_number": "MH12AB1234",
  "type": "truck",
  "type_label": "Truck",
  "driver_name": "Sunil Patil",
  "driver_mobile": "9876543210",
  "company": "ABC Logistics",
  "purpose": "Delivery",
  "host": { "name": "Neha Sharma", "department": "Purchase" },
  "visits": [
    { "id": 8841, "visitor_name": "Ravi Kumar", "people": 2, "host": { "name": "Neha Sharma", "department": "Purchase" } }
  ],
  "visitor_names": ["Ravi Kumar"],
  "in_time": "2026-11-02T09:05:12+05:30",
  "out_time": "2026-11-02T11:20:40+05:30",
  "minutes_inside": 135,
  "status": "out",
  "gate": { "id": 2, "name": "Main gate" },
  "parking_slot": "B4",
  "checked_in_by": "Ramesh Yadav",
  "checked_out_by": "Suresh Pawar",
  "items": "20 cartons",
  "notes": "Blue tarpaulin",
  "photos": {
    "in": "https://kaampilot.com/tasks/api/visitors/v1/vehicles/123/photos/in/",
    "out": null
  },
  "anonymised": false,
  "updated_at": "2026-11-02T11:20:40+05:30"
}
```

### Every field

| Field | Meaning |
|---|---|
| `id` | The record's number. Stays the same for ever |
| `vehicle_number` | The number plate, in capitals without spaces |
| `type` | `car`, `bike`, `truck`, `tempo` or `other` |
| `type_label` | The same in words: Car, Bike / scooter, Truck, Tempo / van, Other |
| `driver_name`, `driver_mobile` | As the guard entered them. May be empty |
| `company` | The company the vehicle is coming from |
| `purpose` | Why it came |
| `host` | Whom it came to meet: `name` and `department`. Taken from the first linked visitor who has one; `null` if none. `department` is empty when a name was only typed |
| `visits` | The visitors who came in this vehicle: visit `id`, `visitor_name`, `people` (how many in that group), their `host`. Empty when none is linked |
| `visitor_names` | Just those names, as a list |
| `in_time` | When it came in |
| `out_time` | When it left. `null` while inside |
| `minutes_inside` | Time inside in minutes. For a vehicle still inside, up to now |
| `status` | `inside` or `out` |
| `gate` | The gate or location (`id`, `name`). `null` if the guard did not pick one |
| `parking_slot` | As entered. May be empty |
| `checked_in_by`, `checked_out_by` | The guard's name. `null` if not known, or if that person's record was deleted |
| `items` | Material or items carried, as entered |
| `notes` | The guard's notes |
| `photos.in`, `photos.out` | The address of each photo, or `null` if there is none. These addresses need the key too |
| `anonymised` | `true` once the record passed your company's retention period (see below) |
| `updated_at` | The last time this record changed |

Make, model and colour are not asked at the gate, so they are not in the data.

**Older records.** After your company's "Keep records for" days (Visitors → Settings), driver name and mobile are blanked,
photos are deleted and visitor names read "Visitor (removed)". The API shows them just as stored, with `anonymised: true`.

### The summary

`from` and `to` are optional; without them you get the last 30 days. At most 366 days at a time.

```json
{
  "from": "2026-10-01",
  "to": "2026-10-03",
  "entries": 48,
  "checked_out": 47,
  "still_inside": 1,
  "average_minutes_inside": 92,
  "longest_minutes_inside": 610,
  "per_day": [
    { "date": "2026-10-01", "count": 20 },
    { "date": "2026-10-02", "count": 28 },
    { "date": "2026-10-03", "count": 0 }
  ],
  "per_type": [
    { "type": "car", "label": "Car", "count": 30 },
    { "type": "truck", "label": "Truck", "count": 18 }
  ]
}
```

Only vehicles that came in within the dates are counted. Average and longest count only vehicles that have left, and are
`null` if none has.

---

## 6. Errors and limits

Every error has the same shape:

```json
{ "error": { "code": "unauthorized", "message": "The API key is missing or not valid." } }
```

| Status | `code` | What it means, what to do |
|---|---|---|
| 400 | `bad_request` | A filter is not valid. The message says which one |
| 400 | `range_too_long` | Summary: ask for at most 366 days |
| 401 | `unauthorized` | Key missing, wrong, revoked or expired. The answer is the same for all of them. Check the key, or ask for a new one |
| 403 | `module_off` | The Visitors module is not on for your company. Ask your Owner |
| 404 | `not_found` | No such record, photo or address |
| 405 | `method_not_allowed` | Only `GET` works |
| 429 | `rate_limited` | Too many requests. Wait the seconds given in the `Retry-After` header, then go on |
| 500 | `server_error` | A problem on our side. Try again in a while; tell Kaampilot support if it stays |

**Limit:** about 120 requests a minute for each key. Photos count as requests. A list of 200 rows is one request, so use
`page_size=200` rather than asking for records one by one.

---

## 7. Keep your own copy up to date

Do not download everything each time. Ask only for what changed:

1. Download everything once and note the time you started.
2. Next time, ask with `updated_since=<that time>` and follow `next` to the end.
3. Replace the rows with the same `id` in your copy. Records are never deleted, only changed.

A record shows up again when a vehicle leaves, when a guard edits it or its linked visitor, and when it is anonymised.
Rows are ordered by entry time, not by change time, and a record can shift between pages if a new vehicle comes in while you
are reading. Matching by `id` makes that harmless.

---

## 8. Excel (Power Query)

In Excel: **Data → Get Data → From Other Sources → Blank Query**, then **Advanced Editor**, and paste this:

```
let
    Key = "YOUR_API_KEY",
    Base = "https://kaampilot.com/tasks/api/visitors/v1",
    GetPage = (page as number) =>
        Json.Document(Web.Contents(Base, [
            RelativePath = "vehicles/",
            Query = [page = Number.ToText(page), page_size = "200", from = "2026-10-01", to = "2026-10-31"],
            Headers = [Authorization = "Bearer " & Key]
        ])),
    First = GetPage(1),
    Pages = List.Generate(
        () => [n = 1, data = First],
        each [data] <> null,
        each [n = [n] + 1, data = if [data][next] = null then null else GetPage([n] + 1)],
        each [data][results]
    ),
    Rows = List.Combine(Pages),
    AsTable = Table.FromList(Rows, Splitter.SplitByNothing(), {"Record"}),
    Expanded = Table.ExpandRecordColumn(AsTable, "Record",
        {"id", "vehicle_number", "type_label", "driver_name", "driver_mobile", "company", "purpose",
         "in_time", "out_time", "minutes_inside", "status", "parking_slot", "checked_in_by", "checked_out_by", "items", "notes"})
in
    Expanded
```

Change the dates, then press **Done** and **Close & Load**. If Excel asks how to connect, choose **Anonymous** (the key is
already in the query).

The key is stored inside the workbook, so anyone with the file can read it. Do not send that workbook to anyone outside the
people the key is meant for.

---

## 9. Good to know

- Only your own company's data can be read with your key. Each company's data is kept apart.
- Only vehicle records and the fields above are available; no other visitor or staff data.
- Your company's Owner or Admin can see each key and when it was last used, and can revoke it at any time.
