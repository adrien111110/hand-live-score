/**
 * SCHL LIVE SCORE - MOTEUR COMPLET
 * Inclus : Chrono, Stats, 7m, Commentaires, Exclusions, Smiley 🤾
 */

// --- CONFIGURATION ---
const supabaseUrl = 'https://rmfcixwuyltwpotijozd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZmNpeHd1eWx0d3BvdGlqb3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMjQyMzgsImV4cCI6MjA4NTYwMDIzOH0.IW9b7431_xQlM1rydhOO551QgIq3bVEOgM5KllSzfTs';
const MATCH_ID = '7d6708ba-b37c-4719-8aea-da68cf7d6147';
const ADMIN_SECRET = "coach2026"; 
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// --- VARIABLES GLOBALES ---
let matchData = null;
let activePenalties = [];
let teamPlayers = [];
let pendingGoalTeam = null;
let fullTimeline = []; 

// --- 1. INITIALISATION ---
async function init() {
    const { data: m } = await supabaseClient.from('matches').select('*').eq('id', MATCH_ID).single();
    matchData = m;
    
    const { data: pList } = await supabaseClient.from('players').select('*').eq('match_id', MATCH_ID).order('number');
    teamPlayers = pList || [];

    const { data: tHistory } = await supabaseClient.from('timeline').select('*').eq('match_id', MATCH_ID).order('created_at', { ascending: true });
    if (tHistory) {
        document.getElementById('timeline-container').innerHTML = '';
        tHistory.forEach(event => addEventToUI(event));
    }

    // Realtime
    supabaseClient.channel('match-live').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, p => { matchData = p.new; updateDOM(); }).subscribe();
    supabaseClient.channel('penalties-live').on('postgres_changes', { event: '*', schema: 'public', table: 'penalties' }, () => reloadPenalties()).subscribe();
    supabaseClient.channel('timeline-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'timeline' }, p => addEventToUI(p.new)).subscribe();

    if (new URLSearchParams(window.location.search).get('admin') === ADMIN_SECRET) {
        document.getElementById('admin-panel').classList.remove('hidden');
        document.getElementById('timeline-container').classList.add('is-admin');
    }
    
    reloadPenalties();
    setInterval(refreshTimers, 100);
    updateDOM();
}

// --- 2. AFFICHAGE INTERFACE ---
function updateDOM() {
    if (!matchData) return;
    document.getElementById('score-home').innerText = matchData.score_home;
    document.getElementById('score-away').innerText = matchData.score_away;
    document.getElementById('home-name').innerText = matchData.home_team;
    document.getElementById('away-name').innerText = matchData.away_team;
    document.getElementById('display-location').innerText = matchData.match_location || "Handball";
    document.getElementById('display-start-time').innerText = matchData.match_start_time || "--:--";
    document.getElementById('display-period').innerText = matchData.period;
    
    if (matchData.home_logo_url) { const img = document.getElementById('home-logo'); img.src = matchData.home_logo_url; img.classList.remove('hidden'); }
    if (matchData.away_logo_url) { const img = document.getElementById('away-logo'); img.src = matchData.away_logo_url; img.classList.remove('hidden'); }
    
    const btn = document.getElementById('btn-timer');
    btn.innerText = matchData.is_running ? 'PAUSE' : 'START';
    btn.className = matchData.is_running ? 'px-10 py-3 rounded-full font-bold bg-red-600 text-white' : 'px-10 py-3 rounded-full font-bold bg-green-500 text-black';
}

// --- 3. GESTION DES BUTS ET JOUEURS ---
async function updateScore(col, inc) {
    if (inc > 0) {
        pendingGoalTeam = col;
        openPlayerModal(col);
    } else {
        const { data } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
        await supabaseClient.from('matches').update({ [col]: Math.max(0, data[col] - 1) }).eq('id', MATCH_ID);
    }
}

function openPlayerModal(team) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    if (team === 'score_home') {
        teamPlayers.forEach(p => {
            const b = document.createElement('button');
            b.className = "bg-slate-800 p-3 rounded-xl text-[11px] font-bold border border-slate-700 hover:bg-indigo-600";
            b.innerText = `#${p.number} ${p.name}`;
            b.onclick = () => confirmGoal(`${p.name} (#${p.number})`);
            list.appendChild(b);
        });
    } else {
        list.innerHTML = '<p class="col-span-2 text-slate-600 text-[10px] italic text-center py-4 uppercase font-bold">Équipe Extérieure</p>';
    }
    document.getElementById('player-modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('player-modal').classList.add('hidden'); }

async function confirmGoal(playerName) {
    const col = pendingGoalTeam;
    const { data } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
    const newVal = data[col] + 1;
    await supabaseClient.from('matches').update({ [col]: newVal }).eq('id', MATCH_ID);

    const sH = col === 'score_home' ? newVal : matchData.score_home;
    const sA = col === 'score_away' ? newVal : matchData.score_away;

    await supabaseClient.from('timeline').insert({
        match_id: MATCH_ID,
        event_type: col === 'score_home' ? 'goal_home' : 'goal_away',
        match_time: document.getElementById('timer-display').innerText,
        score_snapshot: `${sH}-${sA}`,
        player_name: playerName
    });
    closeModal();
}

// --- 4. ÉVÉNEMENTS SPÉCIAUX (7m, Arrêts, Comm, Période) ---
async function logGkSave() {
    await supabaseClient.from('timeline').insert({
        match_id: MATCH_ID, event_type: 'gk_save',
        match_time: document.getElementById('timer-display').innerText,
        score_snapshot: `${matchData.score_home}-${matchData.score_away}`
    });
} 

async function log7m(team) {
    const teamName = team === 'home' ? matchData.home_team : matchData.away_team;
    await supabaseClient.from('timeline').insert({
        match_id: MATCH_ID, event_type: '7m_announced',
        match_time: document.getElementById('timer-display').innerText,
        score_snapshot: `${matchData.score_home}-${matchData.score_away}`,
        player_name: teamName
    });
}

async function sendComment() {
    const input = document.getElementById('admin-comment');
    const comment = input.value.trim();
    if (!comment) return;
    await supabaseClient.from('timeline').insert({
        match_id: MATCH_ID, event_type: 'comment',
        match_time: document.getElementById('timer-display').innerText,
        score_snapshot: `${matchData.score_home}-${matchData.score_away}`,
        player_name: comment
    });
    input.value = '';
}

async function changePeriod(p) { 
    await supabaseClient.from('matches').update({ period: p }).eq('id', MATCH_ID); 
    await supabaseClient.from('timeline').insert({ 
        match_id: MATCH_ID, event_type: 'period_change', 
        match_time: document.getElementById('timer-display').innerText, 
        score_snapshot: `${matchData.score_home}-${matchData.score_away}`, 
        player_name: p 
    });
}

// --- 5. GESTION DES EXCLUSIONS ---
async function addPenalty(team) {
    const end = getCurrentMatchSeconds() + 120;
    await supabaseClient.from('penalties').insert({ match_id: MATCH_ID, team, ends_at_match_seconds: end });
    await supabaseClient.from('timeline').insert({ 
        match_id: MATCH_ID, 
        event_type: team === 'home' ? 'penalty_home' : 'penalty_away', 
        match_time: document.getElementById('timer-display').innerText, 
        score_snapshot: `${matchData.score_home}-${matchData.score_away}` 
    });
}

async function reloadPenalties() { 
    const { data } = await supabaseClient.from('penalties').select('*').eq('match_id', MATCH_ID); 
    activePenalties = data || []; 
}

// --- 6. CHRONO ---
async function toggleTimer() {
    const now = new Date().toISOString();
    if (!matchData.is_running) {
        await supabaseClient.from('matches').update({ is_running: true, last_start_time: now }).eq('id', MATCH_ID);
    } else {
        const added = Math.floor((new Date() - new Date(matchData.last_start_time)) / 1000);
        await supabaseClient.from('matches').update({ is_running: false, timer_seconds: matchData.timer_seconds + added, last_start_time: null }).eq('id', MATCH_ID);
    }
}

async function adjustTimer(s) {
    let total = getCurrentMatchSeconds();
    let newVal = Math.max(0, total + s);
    const update = { timer_seconds: newVal };
    if (matchData.is_running) update.last_start_time = new Date().toISOString();
    await supabaseClient.from('matches').update(update).eq('id', MATCH_ID);
}

function getCurrentMatchSeconds() {
    if (!matchData) return 0;
    let t = matchData.timer_seconds;
    if (matchData.is_running && matchData.last_start_time) {
        t += Math.floor((new Date() - new Date(matchData.last_start_time)) / 1000);
    }
    return t;
}

function refreshTimers() {
    const s = getCurrentMatchSeconds();
    document.getElementById('timer-display').innerText = `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
    renderPenalties('home', s); 
    renderPenalties('away', s);
}

function renderPenalties(team, s) {
    const c = document.getElementById(`penalties-${team}`);
    const active = activePenalties.filter(p => p.team === team && p.ends_at_match_seconds > s);
    c.innerHTML = active.map(p => {
        const r = p.ends_at_match_seconds - s;
        return `<div class="bg-orange-600 text-black text-[9px] font-black py-1 px-2 rounded-lg animate-pulse">2' - ${Math.floor(r/60)}:${(r%60).toString().padStart(2,'0')}</div>`;
    }).join('');
}

// --- 7. TIMELINE ET STATS ---
function addEventToUI(event) {
    if (fullTimeline.some(e => e.id === event.id)) return;
    fullTimeline.push(event);
    calculateStats();

    const container = document.getElementById('timeline-container');
    const isAdmin = new URLSearchParams(window.location.search).get('admin') === ADMIN_SECRET;
    if (isAdmin) container.classList.add('is-admin');
    if (event.event_type === 'gk_save' && !isAdmin) return;
    if (container.innerText.includes("attente")) container.innerHTML = '';

    const isPeriod = event.event_type === 'period_change';
    const div = document.createElement('div');
    div.id = `event-${event.id}`;
    div.className = `flex items-center gap-4 p-4 rounded-2xl border mb-3 animate-event shadow-lg ${isPeriod ? 'bg-amber-500/20 border-amber-500/40 border-l-4 border-l-amber-500' : 'glass-card'}`;
    
    let icon = "🤾", label = "", team = "";

    if (event.event_type.includes('goal')) {
        team = event.event_type.includes('home') ? matchData.home_team : matchData.away_team;
        label = `<span class="text-amber-400 font-black">BUT</span> ${event.player_name || team}`;
    } 
    else if (event.event_type.includes('penalty')) {
        label = "<span class='text-orange-500 font-black'>EXCLUSION 2'</span>"; icon = "✌️";
        team = event.event_type.includes('home') ? matchData.home_team : matchData.away_team;
    } 
    else if (isPeriod) {
        team = "INFO MATCH";
        if (event.player_name === "Mi-Temps") { icon = "☕"; label = "Mi-Temps"; }
        else if (event.player_name === "2ème Période") { icon = "🏃"; label = "REPRISE DU MATCH"; }
        else if (event.player_name === "Match Terminé") { icon = "🏁"; label = "FIN DU MATCH"; }
    }
    else if (event.event_type === '7m_announced') {
        label = `<span class="text-amber-400 font-black">JET DE 7m</span> pour ${event.player_name}`; icon = "🎯"; team = "ARBITRAGE";
    }
    else if (event.event_type === 'comment') {
        label = `<span class="text-white italic font-medium">"${event.player_name}"</span>`; icon = "💬"; team = "DIRECT";
    }
    else if (event.event_type === 'gk_save') {
        label = "<span class='text-indigo-400 font-bold italic'>Arrêt Gardien (Stats)</span>"; icon = "🧤"; team = "SCHL";
    }

    div.innerHTML = `
        <span class="score-font text-amber-500/50 text-[10px] w-9">${event.match_time}</span>
        <div class="flex-1 leading-tight">
            <div class="text-[8px] text-slate-500 uppercase font-black tracking-widest">${team}</div>
            <div class="text-xs font-bold text-slate-300">${label} <span class="text-slate-500 ml-1 text-[10px]">(${event.score_snapshot})</span></div>
        </div>
        <button class="admin-delete-btn" onclick="deleteEvent('${event.id}', '${event.event_type}')">Suppr.</button>
        <span class="text-lg">${icon}</span>
    `;
    container.prepend(div);
}

function calculateStats() {
    const saves = fullTimeline.filter(e => e.event_type === 'gk_save').length;
    const goalsConceded = fullTimeline.filter(e => e.event_type === 'goal_away').length;
    const totalShotsAgainst = saves + goalsConceded;
    const percent = totalShotsAgainst > 0 ? Math.round((saves / totalShotsAgainst) * 100) : 0;
    document.getElementById('stats-gk-percent').innerText = `${percent}%`;
    document.getElementById('stats-gk-details').innerText = `${saves} Arrêt / ${totalShotsAgainst} Tir`;

    const homeGoals = fullTimeline.filter(e => e.event_type === 'goal_home' && e.player_name);
    const counts = {};
    homeGoals.forEach(g => { counts[g.player_name] = (counts[g.player_name] || 0) + 1; });
    const sortedScorers = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const container = document.getElementById('stats-scorers');
    container.innerHTML = sortedScorers.length > 0 ? sortedScorers.map(([name, count]) => `<div class="flex justify-between items-center border-b border-slate-800/50 pb-1"><span class="text-[11px] font-bold text-slate-300">${name}</span><span class="score-font text-amber-400 text-xs">${count}</span></div>`).join('') : '<p class="text-[10px] text-slate-600 italic">Aucun buteur...</p>';
}

// --- 8. SUPPRESSION ET RESET ---
async function deleteEvent(eventId, type) {
    try {
        if (type === 'goal_home' || type === 'goal_away') {
            const col = type === 'goal_home' ? 'score_home' : 'score_away';
            const { data: match } = await supabaseClient.from('matches').select(col).eq('id', MATCH_ID).single();
            await supabaseClient.from('matches').update({ [col]: Math.max(0, match[col] - 1) }).eq('id', MATCH_ID);
        } else if (type.includes('penalty')) {
            const team = type.includes('home') ? 'home' : 'away';
            const { data: p } = await supabaseClient.from('penalties').select('id').eq('match_id', MATCH_ID).eq('team', team).order('created_at', { ascending: false }).limit(1).single();
            if (p) await supabaseClient.from('penalties').delete().eq('id', p.id);
        }
        await supabaseClient.from('timeline').delete().eq('id', eventId);
        fullTimeline = fullTimeline.filter(e => e.id !== eventId);
        const element = document.getElementById(`event-${eventId}`);
        if (element) element.remove();
        calculateStats();
    } catch (err) { console.error(err); }
}

async function resetTimer() { 
    if(confirm("Réinitialiser tout le match ?")) { 
        await supabaseClient.from('matches').update({ is_running: false, timer_seconds: 0, last_start_time: null, score_home: 0, score_away: 0, period: '1ère Période' }).eq('id', MATCH_ID); 
        await supabaseClient.from('penalties').delete().eq('match_id', MATCH_ID); 
        await supabaseClient.from('timeline').delete().eq('match_id', MATCH_ID); 
        location.reload(); 
    }
}

init();
