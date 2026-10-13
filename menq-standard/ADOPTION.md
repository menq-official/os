# Adopting MenQ Standard in a repository / MenQ Standard-ի ընդունումը repository-ում

**Status / Կարգավիճակ:** In force under `D-029`; `menqstudio/OS` followed the Adopt steps on GitHub on 2026-10-10, the update steps have not run anywhere / Ուժի մեջ է `D-029`-ով. `menqstudio/OS`-ը Adopt քայլերը GitHub-ում կատարել է 2026-10-10-ին, update քայլերը ոչ մի տեղ չեն գործարկվել  
**Document class / Փաստաթղթի դաս:** Informative  
**Owner / Պատասխանատու:** MenQ Owner  
**Canonical path / Canonical ուղի:** `consumer/ADOPTION.md`

## English

Every command below was run on 2026-10-09, in this order, in a throwaway repository made for the
purpose, with Python 3.13 and no network. Step 3 of “Adopt” changed in version 2.1.0, and the
“Adopt” steps 1 to 4 were run again as they now read on 2026-10-10, the same way; step 5 was not
run again. Two things were therefore NOT exercised and are named where they occur: fetching from
GitHub, and anything GitHub Actions does. What binds the repository afterwards is in
`CONSUMER_CONTRACT.md`.

Run everything from the root of the repository that adopts the standard. It needs git and
Python 3; nothing is installed.

### Adopt

**1. Fetch the standard beside the repository.** The standard is public, so no token is needed.
In the run, `STANDARD_URL` held the path of a local clone; the GitHub URL was not fetched.

```bash
STANDARD_URL=https://github.com/menqstudio/MenQ-Standard.git
git clone "$STANDARD_URL" ../MenQ-Standard
```

**2. Copy the kit, write the pin, render the two workflows.** One command. It writes the kit into
`menq-standard/`, the pin into `.menq-standard.json`, and the workflows into
`.github/workflows/menq-standard-conformance.yml` and `.github/workflows/menq-standard-update.yml`.
Leave out `--with-update-workflow` to adopt without the update path.

```bash
python3 ../MenQ-Standard/consumer/check_conformance.py install --standard ../MenQ-Standard --standard-ref origin/main --with-update-workflow
```

**3. Write the core of the session-read manifest, and let the gate write the rest** (`D-028`). The
core is yours to choose: the ordered files every AI session reads in full, the byte ceiling of
each, and a total no greater than 350,000. Leave `areas` as `{}`. Every tracked Markdown file must
be reachable from the core or an area, the three Markdown files of the kit included, and
`--sync-areas` sees to that: it adds each tracked Markdown file that nothing reaches to the area
of its own directory. It reads tracked files, so `git add` comes first. This is the manifest of
the throwaway repository, which held `README.md` and `docs/GUIDE.md`; a real repository lists its
own core and its own numbers.

```bash
cat > SESSION_READ_MANIFEST.json <<'JSON'
{
  "schema_version": 1,
  "total_bytes_max": 20000,
  "core": [
    {"path": "README.md", "bytes_max": 20000, "why": "What the repository is and how to work in it."}
  ],
  "areas": {}
}
JSON
git add --all
python3 menq-standard/check_session_read_budget.py --sync-areas
```

In the run it printed `SESSION READ AREAS: WRITTEN (4 area files in 2 directories; 4 added,
0 removed) to SESSION_READ_MANIFEST.json` and named the four files. It rewrites the whole file as
2-space indented JSON; only the value of `areas` changes.

Run the same command again whenever a Markdown file is added or removed. It repairs, it does not
regenerate: an entry you wrote by hand is kept where it is — a file of another directory, one file
in several areas, an order you chose. It removes only an entry whose file is gone or is in the
core, and it appends only a file that nothing reaches. It never changes the core, and it refuses a
missing or malformed manifest. When there is nothing to do it says `UNCHANGED` and does not write.

**4. Track the files and check.** The budget gate reads tracked files, so `git add` comes first;
here it tracks the manifest as step 3 left it.
With `--standard` the pin is compared with the standard itself, as the workflow will do.

```bash
git add --all
python3 menq-standard/check_conformance.py check --standard ../MenQ-Standard --standard-ref origin/main
```

**5. Commit and push as a person.** The commit adds workflow files; a push that adds or changes a
workflow file needs a person's credentials with the `workflow` scope.

```bash
git commit --quiet --message "Adopt MenQ Standard"
git push --quiet origin HEAD
```

**6. Turn on one setting, only if the update workflow was rendered.** In the repository on GitHub:
Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and approve
pull requests**. The update workflow declares `contents: write` and `pull-requests: write` for
itself; without the setting, GitHub refuses the pull request it tries to open. Not exercised here.

### See whether the repository is behind, by hand

Exit code 0 means current, 10 means behind, 1 means the pin is not true of the standard.

```bash
git -C ../MenQ-Standard fetch --quiet origin
python3 menq-standard/check_conformance.py status --standard ../MenQ-Standard --standard-ref origin/main
```

### When an update pull request arrives

The update workflow opens it weekly when the pin is behind. Its branch is named
`menq-standard/update-<new version>`, and it changes the kit directory and the pin, nothing else.
Nothing merges it.

**1. Read the pull request.** It quotes which kit files differ, the conformance verdict on the
branch as the update job saw it, and the standard's changelog between the two versions.

**2. Check the branch yourself.** A pull request opened by an Actions token does not start the
repository's workflows, so no conformance run appears on it until a person runs the workflow on
the branch or closes and reopens the pull request. With the branch name in `UPDATE_BRANCH`:

```bash
git fetch --quiet origin "$UPDATE_BRANCH"
git checkout --quiet -B "$UPDATE_BRANCH" FETCH_HEAD
git -C ../MenQ-Standard fetch --quiet origin
python3 menq-standard/check_conformance.py check --standard ../MenQ-Standard --standard-ref origin/main
```

**3. Fix what is RED, on the branch.** The usual reason is a new Markdown file in the kit that the
session-read manifest does not list: run the gate with `--sync-areas`, as in step 3 of “Adopt”,
which adds it to the `menq-standard` area; then commit and push. That command was run for an added
Markdown file on 2026-10-10, though not on an update branch.

**4. Re-render the workflows when the pull request says a template changed.** The update job cannot
do it, because an Actions token may not write under `.github/workflows/`. The first command reads
the commit the branch pins, so the workflows are rendered for exactly that commit.

```bash
PIN_COMMIT="$(python3 menq-standard/check_conformance.py pin-commit --standard ../MenQ-Standard --standard-ref origin/main)"
python3 menq-standard/check_conformance.py install --standard ../MenQ-Standard --standard-ref "$PIN_COMMIT" --render-workflows
git add --all
git commit --quiet --message "Re-render the MenQ Standard workflows"
git push --quiet origin "$UPDATE_BRANCH"
```

**5. A person merges it,** or closes it. To undo a merged update, revert its merge commit: the kit
and the pin go back together.

## Հայերեն

Ներքևի ամեն հրաման գործարկվել է 2026-10-09-ին, այս հերթականությամբ, այդ նպատակով ստեղծված
ժամանակավոր repository-ում, Python 3.13-ով և առանց ցանցի։ «Ընդունում» բաժնի 3-րդ քայլը փոխվել է
2.1.0 տարբերակում, և «Ընդունում» բաժնի 1-ից 4-րդ քայլերը, ինչպես այժմ գրված են, նորից գործարկվել
են 2026-10-10-ին նույն ձևով. 5-րդ քայլը նորից չի գործարկվել։ Ուստի երկու բան ՉԻ փորձարկվել, և
դրանք նշված են իրենց տեղում՝ GitHub-ից fetch-ը և այն ամենը, ինչ անում է GitHub Actions-ը։ Թե ինչն
է դրանից հետո պարտադիր repository-ի համար՝ գրված է `CONSUMER_CONTRACT.md`-ում։

Ամեն ինչ գործարկիր ստանդարտն ընդունող repository-ի root-ից։ Պետք են git և Python 3. ոչինչ չի
տեղադրվում։ Հրամանները նույնն են երկու լեզվով և գրված են անգլերեն բաժնում. այստեղ բացատրված է
ամեն քայլը։

### Ընդունում

**1. Ստանդարտը fetch արա repository-ի կողքին։** Ստանդարտը public է, ուստի token պետք չէ։
Գործարկման ժամանակ `STANDARD_URL`-ը local clone-ի ուղին էր. GitHub-ի URL-ը fetch չի արվել։

**2. Պատճենիր kit-ը, գրիր pin-ը, render արա երկու workflow-ը։** Մեկ հրաման՝ `install`։ Այն kit-ը
գրում է `menq-standard/`-ում, pin-ը՝ `.menq-standard.json`-ում, իսկ workflow-ները՝
`.github/workflows/menq-standard-conformance.yml`-ում և `.github/workflows/menq-standard-update.yml`-ում։
Առանց update ճանապարհի ընդունելու համար բաց թող `--with-update-workflow`-ը։

**3. Գրիր session-read manifest-ի core-ը, իսկ մնացածը թող գրի gate-ը** (`D-028`)։ Core-ը դու ես
ընտրում՝ հերթականությամբ այն ֆայլերը, որոնք ամեն AI session կարդում է ամբողջությամբ, ամեն մեկի
բայթերի սահմանը և ընդհանուրը՝ 350,000-ից ոչ ավելի։ `areas`-ը թող `{}`։ Ամեն tracked Markdown ֆայլ
պետք է հասանելի լինի core-ից կամ area-ից, ներառյալ kit-ի երեք Markdown ֆայլը, և դա ապահովում է
`--sync-areas`-ը. այն ամեն tracked Markdown ֆայլ, որին ոչինչ չի հասնում, ավելացնում է իր
directory-ի area-ին։ Այն կարդում է tracked ֆայլերը, ուստի նախ `git add`։ Անգլերեն բաժնի օրինակը
ժամանակավոր repository-ի manifest-ն է, որն ուներ `README.md` և `docs/GUIDE.md`. իրական
repository-ն գրում է իր core-ը և իր թվերը։

Գործարկման ժամանակ այն տպեց `SESSION READ AREAS: WRITTEN (4 area files in 2 directories; 4 added,
0 removed) to SESSION_READ_MANIFEST.json` և անվանեց չորս ֆայլը։ Այն ամբողջ ֆայլը նորից գրում է
որպես 2 բացատով indent արված JSON. փոխվում է միայն `areas`-ի արժեքը։

Նույն հրամանը նորից գործարկիր ամեն անգամ, երբ Markdown ֆայլ է ավելանում կամ հեռացվում։ Այն
նորոգում է, ոչ թե նորից գեներացնում. ձեռքով գրված գրառումը մնում է իր տեղում՝ ուրիշ directory-ի
ֆայլը, մի քանի area-ում նշված նույն ֆայլը, քո ընտրած հերթականությունը։ Այն հեռացնում է միայն այն
գրառումը, որի ֆայլը այլևս չկա կամ core-ում է, և ավելացնում է միայն այն ֆայլը, որին ոչինչ չի
հասնում։ Այն երբեք չի փոխում core-ը և մերժում է բացակայող կամ սխալ կառուցվածքով manifest-ը։ Երբ
անելիք չկա, այն գրում է `UNCHANGED` և ֆայլը չի գրում։

**4. Track արա ֆայլերը և ստուգիր։** Budget gate-ը կարդում է tracked ֆայլերը, ուստի նախ `git add`.
այստեղ այն track է անում manifest-ը այնպես, ինչպես թողել է 3-րդ քայլը։
`--standard`-ով pin-ը համեմատվում է հենց ստանդարտի հետ, ինչպես կանի workflow-ը։

**5. Commit և push արա որպես մարդ։** Commit-ը ավելացնում է workflow ֆայլեր. workflow ֆայլ
ավելացնող կամ փոխող push-ը պահանջում է մարդու credentials՝ `workflow` scope-ով։

**6. Միացրու մեկ կարգավորում, միայն եթե update workflow-ը render է արվել։** GitHub-ում
repository-ի Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create
and approve pull requests**։ Update workflow-ը ինքն իր համար հայտարարում է `contents: write` և
`pull-requests: write`. առանց այդ կարգավորման GitHub-ը մերժում է pull request-ը, որը այն փորձում է
բացել։ Այստեղ չի փորձարկվել։

### Ձեռքով տեսնել՝ repository-ն հետ է մնացել, թե ոչ

`status` հրամանի exit code-ը 0 է, երբ pin-ը ընթացիկ է, 10՝ երբ հետ է մնացել, 1՝ երբ pin-ը
ստանդարտի մասին ճիշտ չէ։

### Երբ update pull request է գալիս

Update workflow-ը այն բացում է շաբաթը մեկ, երբ pin-ը հետ է մնացել։ Նրա branch-ի անունն է
`menq-standard/update-<նոր տարբերակ>`, և այն փոխում է kit-ի directory-ն ու pin-ը, ուրիշ ոչինչ։ Ոչինչ
այն merge չի անում։

**1. Կարդա pull request-ը։** Այն մեջբերում է, թե kit-ի որ ֆայլերն են տարբերվում, branch-ի
conformance-ի վճիռը՝ ինչպես այն տեսել է update job-ը, և ստանդարտի changelog-ը երկու տարբերակների
միջև։

**2. Ինքդ ստուգիր branch-ը։** Actions token-ով բացված pull request-ը չի գործարկում repository-ի
workflow-ները, ուստի conformance run չի երևում, մինչև մարդը workflow-ը չգործարկի branch-ի վրա կամ
չփակի ու նորից չբացի pull request-ը։ Հրամանները branch-ի անունը վերցնում են `UPDATE_BRANCH`-ից։

**3. Ուղղիր այն, ինչ RED է, branch-ի վրա։** Սովորական պատճառը kit-ի նոր Markdown ֆայլն է, որը
session-read manifest-ը չի թվարկում. գործարկիր gate-ը `--sync-areas`-ով, ինչպես «Ընդունում» բաժնի
3-րդ քայլում, և այն ֆայլը կավելացնի `menq-standard` area-ին. հետո commit և push արա։ Այդ հրամանը
ավելացված Markdown ֆայլի համար գործարկվել է 2026-10-10-ին, թեև ոչ update branch-ի վրա։

**4. Նորից render արա workflow-ները, երբ pull request-ը ասում է, որ template-ը փոխվել է։** Update
job-ը դա չի կարող անել, քանի որ Actions token-ը չի կարող գրել `.github/workflows/`-ում։ Առաջին
հրամանը կարդում է այն commit-ը, որը branch-ը pin է անում, ուստի workflow-ները render են արվում
հենց այդ commit-ի համար։

**5. Մարդն է merge անում,** կամ փակում։ Merge արված update-ը հետ բերելու համար revert արա նրա
merge commit-ը. kit-ը և pin-ը հետ են գնում միասին։

<!-- END: CONSUMER_ADOPTION -->
