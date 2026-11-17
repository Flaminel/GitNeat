import random, subprocess, sys
seed=int(sys.argv[1]); nt=int(sys.argv[2]); path=sys.argv[3]
random.seed(seed)
subprocess.run(["rm","-rf",path]); subprocess.run(["git","init","-q","-b","main",path],check=True)
out=[]
N=500
for i in range(1,N+1):
    t=1600000000+random.randrange(nt)
    out.append(f"commit refs/heads/tmp\nmark :{i}\nauthor A <a@x> {t} +0000\ncommitter A <a@x> {t} +0000\ndata 3\nc{i%10}\n")
    if i>1:
        # parent mostly recent, sometimes old
        p=random.randint(max(1,i-6),i-1) if random.random()<0.8 else random.randint(1,i-1)
        out.append(f"from :{p}\n")
        if random.random()<0.35 and i>3:
            q=random.randint(1,i-1)
            if q!=p: out.append(f"merge :{q}\n")
    out.append(f"M 644 inline f{i}\ndata 1\nx\n\n")
for k in range(25):
    out.append(f"reset refs/heads/b{k}\nfrom :{random.randint(1,N)}\n\n")
for k in range(8):
    out.append(f"reset refs/remotes/origin/r{k}\nfrom :{random.randint(1,N)}\n\n")
subprocess.run(["git","-C",path,"fast-import","--quiet"],input="".join(out).encode(),check=True)
subprocess.run(["git","-C",path,"update-ref","-d","refs/heads/tmp"])
subprocess.run(["git","-C",path,"symbolic-ref","HEAD","refs/heads/b3"])
