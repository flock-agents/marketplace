# Labels and groups for channels_list rows, the way Slack's own sidebar names them.
#
# Input: {channels: raw conversations.list rows, users: slim users.list rows}.
# Args: $self (the owner's user id), $sort ("" | "name" | "members").
#
# Every existing field is kept as it was — `name` stays Slack's raw name (a U-id for a DM,
# mpdm-a--b--c-1 for a group DM) because callers match on it. `label` and `group` are added:
#   public channel   #product-feedback            Channels
#   private channel  🔒 aggy-test                  Channels
#   DM               Yogesh Kumar  /  Shiva (you)  Direct messages
#   group DM         Yogesh, Anil, Priya           Group DMs
# A name that cannot be resolved falls back to the handle, then to the raw id.

def display($u): ($u.display_name // "") as $d | ($u.real_name // "") as $r
  | if $d != "" then $d elif $r != "" then $r else ($u.name // "") end;

.users as $users
| ($users | map({key: .id, value: .}) | from_entries) as $byId
| ($users | map(select((.name // "") != "") | {key: .name, value: .}) | from_entries) as $byHandle
| ($byId[$self].name // "") as $selfHandle

# Group-DM members from Slack's own name: mpdm-<h1>--<h2>--<h3>-<n>. Handles may contain single
# hyphens, never a double one, so "--" is the separator.
| def mpimHandles: (.name // "") | sub("^mpdm-"; "") | sub("-[0-9]+$"; "") | split("--");

  [ .channels[] | . as $c
    | {
        id: .id,
        name: (.name // .user // "dm"),
        is_channel: (.is_channel // false),
        is_group:   (.is_group // false),
        is_im:      (.is_im // false),
        is_mpim:    (.is_mpim // false),
        is_private: (.is_private // false),
        is_member:  (.is_member // false),
        num_members:(.num_members // 0),
        topic:      (.topic.value // ""),
        purpose:    (.purpose.value // "")
      }
    | if .is_im then
        ($c.user // "") as $uid
        | ($byId[$uid]) as $u
        | . + {
            group: "Direct messages",
            label: ((if $u then display($u) else "" end) as $n
                    | (if $n != "" then $n elif $uid != "" then $uid else "dm" end)
                    + (if $uid != "" and $uid == $self then " (you)" else "" end))
          }
      elif .is_mpim then
        . + {
          group: "Group DMs",
          label: ([ $c | mpimHandles[] | select(. != "" and . != $selfHandle)
                    | . as $h | ($byHandle[$h]) as $u
                    | if $u then (display($u) | if . == "" then $h else . end) else $h end ]
                  | join(", ")
                  | if . == "" then ($c.name // $c.id) else . end)
        }
      elif .is_private then . + { group: "Channels", label: ("🔒 " + (.name // .id)) }
      else . + { group: "Channels", label: ("#" + (.name // .id)) }
      end
  ]
| if $sort == "name" then sort_by(.name)
  elif $sort == "members" then sort_by(-.num_members)
  else sort_by(
    (if .group == "Channels" then 0 elif .group == "Direct messages" then 1 else 2 end),
    (.label | ascii_downcase | ltrimstr("#") | ltrimstr("🔒 "))
  ) end
